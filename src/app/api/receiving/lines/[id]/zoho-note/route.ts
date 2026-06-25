/**
 * PATCH /api/receiving/lines/[id]/zoho-note
 *
 * Save the per-line Zoho **item description** (`receiving_lines.zoho_notes`).
 * Edited inline in the PO-items row (the notes-icon toggle). Local persist;
 * org-scoped. Reuses the `receiving.mark_received` permission.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.mark_received');
    if (gate.denied) return gate.denied;
    const ctx = gate.ctx;

    const { id: idRaw } = await params;
    const lineId = Number(idRaw);
    if (!Number.isFinite(lineId) || lineId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid line id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    if (!Object.prototype.hasOwnProperty.call(body, 'zoho_notes')) {
      return NextResponse.json({ success: false, error: 'zoho_notes is required' }, { status: 400 });
    }
    const raw = body.zoho_notes;
    const next = raw == null || raw === '' ? null : String(raw).trim() || null;
    const orgId = ctx.organizationId;

    const res = await tenantQuery<{ id: number }>(
      orgId,
      `UPDATE receiving_lines SET zoho_notes = $1, updated_at = NOW()
         WHERE id = $2 AND organization_id = $3 RETURNING id`,
      [next, lineId, orgId],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ success: false, error: `receiving_line ${lineId} not found` }, { status: 404 });
    }

    after(async () => {
      try { await invalidateCacheTags(['receiving-lines', 'receiving-logs']); } catch { /* best-effort */ }
    });

    return NextResponse.json({ success: true, line_id: lineId, zoho_notes: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save item description';
    console.error('receiving/lines/[id]/zoho-note PATCH failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
