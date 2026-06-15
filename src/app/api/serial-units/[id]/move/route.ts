import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { findByNormalizedSerial } from '@/lib/neon/serial-units-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';

/**
 * POST /api/serial-units/[id]/move — move a unit into a bin/zone.
 *
 * Resolves the target location by `bin_barcode`, `bin_name`, or `bin_id`
 * (first non-empty wins). Updates `serial_units.current_location` to the
 * canonical bin name and emits an `inventory_events` MOVED row carrying
 * `prev_bin_id` + `bin_id` so the History Log shows the actual transition.
 *
 * Body:
 *   {
 *     bin_barcode?: string;
 *     bin_name?: string;
 *     bin_id?: number;
 *     notes?: string;
 *     client_event_id?: string; // idempotency key
 *   }
 *
 * Notes:
 *   - We DO NOT touch bin_contents/qty here. That projection is maintained
 *     via sku_stock_ledger triggers; serial moves don't change a SKU's
 *     total stock, only its location. See locations repo header.
 *   - If the unit has no prior location, this acts as the first putaway.
 */
export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    const idParam = extractIdSegment(request.nextUrl.pathname);
    if (!idParam) {
      return NextResponse.json({ error: 'serial unit id or serial number required' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const binBarcode =
      typeof body.bin_barcode === 'string' && body.bin_barcode.trim() ? body.bin_barcode.trim() : null;
    const binName =
      typeof body.bin_name === 'string' && body.bin_name.trim() ? body.bin_name.trim() : null;
    const binIdRaw =
      typeof body.bin_id === 'number' && Number.isFinite(body.bin_id) ? body.bin_id : null;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const clientEventId =
      typeof body.client_event_id === 'string' ? body.client_event_id : null;

    if (!binBarcode && !binName && binIdRaw == null) {
      return NextResponse.json(
        { error: 'bin_barcode, bin_name, or bin_id is required' },
        { status: 400 },
      );
    }

    const orgId = ctx.organizationId;

    // 1. Resolve target location — org-scoped so a caller can't reference (or
    //    probe the existence of) another org's bin by barcode/name/id. locations
    //    is tenant-owned; the shared repo lookups run unscoped on the bypass
    //    pool, so we resolve through the tenant pool with an explicit
    //    organization_id predicate instead.
    let target =
      binBarcode != null ? await findLocationByBarcodeOrg(binBarcode, orgId) : null;
    if (!target && binName != null) target = await findLocationByNameOrg(binName, orgId);
    if (!target && binIdRaw != null) target = await getLocationByIdOrg(binIdRaw, orgId);
    if (!target) {
      return NextResponse.json(
        { error: `Location not found (${binBarcode || binName || binIdRaw})` },
        { status: 404 },
      );
    }

    // 2. Resolve the unit + its current location for the prev_bin_id field.
    const unit = await resolveUnit(idParam, orgId);
    if (!unit) {
      return NextResponse.json({ error: 'Serial unit not found' }, { status: 404 });
    }

    const prevLocationName = unit.current_location;
    let prevBinId: number | null = null;
    if (prevLocationName) {
      const prevLoc =
        (await findLocationByNameOrg(prevLocationName, orgId)) ??
        (await findLocationByBarcodeOrg(prevLocationName, orgId));
      prevBinId = prevLoc?.id ?? null;
    }

    if (prevBinId === target.id && prevLocationName === target.name) {
      // Already there — idempotent return.
      return NextResponse.json({
        success: true,
        unit_id: unit.id,
        location: { id: target.id, name: target.name, barcode: target.barcode },
        unchanged: true,
      });
    }

    // 3. Update current_location. Storing the canonical name keeps
    //    serial_units self-describing without forcing a join for read paths.
    try {
      await tenantQuery(
        orgId,
        `UPDATE serial_units
           SET current_location = $1,
               updated_at = NOW()
         WHERE id = $2
           AND organization_id = $3`,
        [target.name, unit.id, orgId],
      );
    } catch (err) {
      console.error('[move] update serial_units.current_location failed', err);
      const msg = err instanceof Error ? err.message : 'Move failed';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // 4. Lifecycle event.
    try {
      await recordInventoryEvent({
        event_type: 'MOVED',
        actor_staff_id: ctx.staffId ?? null,
        station: 'MOBILE',
        serial_unit_id: unit.id,
        sku: unit.sku,
        bin_id: target.id,
        prev_bin_id: prevBinId,
        client_event_id: clientEventId,
        notes,
        scan_token: binBarcode ?? null,
        payload: {
          from: prevLocationName,
          to: target.name,
        },
      }, undefined, orgId);
    } catch (err) {
      console.warn('[move] MOVED event failed (non-fatal)', err);
    }

    return NextResponse.json({
      success: true,
      unit_id: unit.id,
      location: { id: target.id, name: target.name, barcode: target.barcode },
      previous_location: prevLocationName,
    });
  },
  { permission: 'tech.scan_serial' },
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractIdSegment(pathname: string): string {
  const m = /\/api\/serial-units\/([^/]+)\/move/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}

interface UnitLite {
  id: number;
  sku: string | null;
  current_location: string | null;
}

async function resolveUnit(raw: string, orgId: OrgId): Promise<UnitLite | null> {
  if (/^\d+$/.test(raw)) {
    const r = await tenantQuery<UnitLite>(
      orgId,
      `SELECT id, sku, current_location FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [Number(raw), orgId],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const fallback = await findByNormalizedSerial(raw, orgId);
  if (!fallback) return null;
  return {
    id: fallback.id,
    sku: fallback.sku ?? null,
    current_location: fallback.current_location ?? null,
  };
}

// ─── locations: org-scoped lookups ───────────────────────────────────────────
// locations is tenant-owned (has organization_id). The shared repo helpers read
// it bare on the bypass pool, which lets a caller resolve another org's bin by
// barcode/name/id. We re-resolve through the tenant pool with an explicit
// organization_id predicate so a cross-tenant bin is invisible (404).

interface LocationLite {
  id: number;
  name: string;
  barcode: string | null;
}

async function findLocationByBarcodeOrg(barcode: string, orgId: OrgId): Promise<LocationLite | null> {
  const r = await tenantQuery<LocationLite>(
    orgId,
    `SELECT id, name, barcode FROM locations WHERE barcode = $1 AND organization_id = $2 LIMIT 1`,
    [barcode, orgId],
  );
  return r.rows[0] ?? null;
}

async function findLocationByNameOrg(name: string, orgId: OrgId): Promise<LocationLite | null> {
  const r = await tenantQuery<LocationLite>(
    orgId,
    `SELECT id, name, barcode FROM locations WHERE name = $1 AND organization_id = $2 LIMIT 1`,
    [name, orgId],
  );
  return r.rows[0] ?? null;
}

async function getLocationByIdOrg(id: number, orgId: OrgId): Promise<LocationLite | null> {
  const r = await tenantQuery<LocationLite>(
    orgId,
    `SELECT id, name, barcode FROM locations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId],
  );
  return r.rows[0] ?? null;
}
