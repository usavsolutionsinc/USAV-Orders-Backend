import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { POST as unifiedDelete } from '@/app/api/tech/delete/route';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Legacy POST /api/tech/delete-tracking — thin wrapper around POST /api/tech/delete.
 * Resolves SAL id from { sourceRowId, sourceKind } or { rowId }, then delegates.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const orgId = ctx.organizationId;
  const sourceRowId = body.sourceRowId ? Number(body.sourceRowId) : null;
  const sourceKind = String(body.sourceKind || '').trim();
  const rowId = body.rowId ? Number(body.rowId) : null;

  let salId: number | null = null;

  // If sourceKind is a SAL-based row (fba_scan or tech_scan), the sourceRowId IS
  // the SAL id — BUT it comes straight from the request body, so it must be
  // org-verified before use. The downstream POST /api/tech/delete (unifiedDelete)
  // deletes by raw SAL id with NO organization_id predicate, and this wrapper is
  // the only org gate in front of it. Verify sourceRowId is a TECH-station SAL
  // owned by this org (mirrors the rowId-as-SAL fallback below) so a tech in
  // org A cannot delete another tenant's SAL/TSN/fba_fnsku_logs rows.
  if (sourceRowId && (sourceKind === 'fba_scan' || sourceKind === 'tech_scan')) {
    const r = await tenantQuery(
      orgId,
      `SELECT id FROM station_activity_logs WHERE id = $1 AND station = 'TECH' AND organization_id = $2 LIMIT 1`,
      [sourceRowId, orgId],
    );
    salId = r.rows[0]?.id ?? null;
  }

  // If sourceKind is tech_serial, find the SAL via context_station_activity_log_id
  if (!salId && sourceRowId && sourceKind === 'tech_serial') {
    const r = await tenantQuery(
      orgId,
      `SELECT context_station_activity_log_id FROM tech_serial_numbers WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [sourceRowId, orgId],
    );
    salId = r.rows[0]?.context_station_activity_log_id ?? null;
  }

  // Fallback: try rowId as a TSN id
  if (!salId && rowId) {
    const r = await tenantQuery(
      orgId,
      `SELECT context_station_activity_log_id FROM tech_serial_numbers WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [rowId, orgId],
    );
    salId = r.rows[0]?.context_station_activity_log_id ?? null;
  }

  // Final fallback: try rowId as a SAL id directly
  if (!salId && rowId) {
    const r = await tenantQuery(
      orgId,
      `SELECT id FROM station_activity_logs WHERE id = $1 AND station = 'TECH' AND organization_id = $2 LIMIT 1`,
      [rowId, orgId],
    );
    salId = r.rows[0]?.id ?? null;
  }

  if (!salId) {
    return NextResponse.json({ success: false, error: 'Could not resolve scan session for deletion' }, { status: 404 });
  }

  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');
  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ salId }),
  });

  return unifiedDelete(syntheticReq, { params: Promise.resolve({}) });
}, { permission: 'tech.scan_serial' });
