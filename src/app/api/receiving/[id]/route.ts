import { NextRequest, NextResponse, after } from 'next/server';
import { syncPoHeaderNotesToZoho } from '@/lib/receiving/zoho-po-notes-sync';
import { resolveCartonZohoPoId } from '@/lib/receiving/resolve-carton-po-id';
import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { readTimeline } from '@/lib/inventory/events';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { getOrgPlatforms, getOrgTypes } from '@/lib/catalog/org-catalog';
import { getReceivingSchema } from '@/lib/receiving-schema-cache';

const SOURCE_PLATFORMS = new Set([
  'zoho',
  'ebay',
  'amazon',
  'aliexpress',
  'walmart',
  'other',
  'goodwill',
  // 'ecwid' — auto-applied by the Link Repair Service flow when an
  // unmatched carton is paired with a recent Ecwid -RS order.
  'ecwid',
]);

// Carton-level default receiving type (receiving.intake_type). Per-line
// receiving_lines.receiving_type overrides; see migration 2026-06-13b.
const INTAKE_TYPES = new Set(['PO', 'RETURN', 'TRADE_IN']);

// Return-platform vocabulary (receiving.return_platform). Mirrors the
// return_platform_enum DB type and the RETURN_PLATFORM_LABELS keys in
// src/components/sidebar/receiving/receiving-sidebar-shared.ts. Kept as a local
// Set so the API route stays independent of the UI layer, matching the
// SOURCE_PLATFORMS / INTAKE_TYPES convention above.
const RETURN_PLATFORMS = new Set([
  'AMZ',
  'EBAY_DRAGONH',
  'EBAY_USAV',
  'EBAY_MK',
  'FBA',
  'WALMART',
  'ECWID',
]);

/**
 * GET /api/receiving/:id
 * Full carton view used by the mobile /m/r/:id page. One round-trip:
 *   - receiving row (tracking, platform, return info, dates)
 *   - distinct POs touched
 *   - lines with serials
 *   - totals
 *   - last 30 inventory_events on this carton
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.view');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid id is required' },
        { status: 400 },
      );
    }

    const cartonRes = await tenantQuery(
      orgId,
      `SELECT
         r.id,
         r.shipment_id,
         stn.tracking_number_raw AS tracking,
         COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)            AS carrier,
         r.source,
         r.source_platform,
         r.intake_type,
         lpo.id AS local_pickup_order_id,
         r.is_return,
         r.return_platform,
         r.return_reason,
         r.needs_test,
         r.assigned_tech_id,
         r.target_channel,
         r.qa_status,
         r.disposition_code,
         r.condition_grade,
         r.zoho_purchase_receive_id,
         r.zoho_purchaseorder_id,
         r.zoho_purchaseorder_number,
         r.zoho_warehouse_id,
         r.support_notes,
         r.listing_url,
         -- 3-stage operator lifecycle: Scanned (tracking_scanned_*, door scan) →
         -- Unboxed (r.unboxed_at, first Unbox-surface scan) → Received (the terminal
         -- DONE time = MAX(receiving_lines.received_done_at)). "Received" is NOT the
         -- unbox event: a carton can be unboxed (9:05) yet not finished/received.
         to_char(recv_done.received_done_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS received_at,
         recv_done.received_by                                       AS received_by,
         to_char(r.unboxed_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')   AS unboxed_at,
         r.unboxed_by,
         -- Tracking-scan provenance. Prefer the earliest receiving_scans row
         -- (per-scan audit log) so we surface the literal tracking-scan event;
         -- fall back to receiving.received_at / received_by for rows that
         -- pre-date the scans-log or were created via other paths.
         to_char(
           COALESCE(rs_first.scanned_at, r.received_at)::timestamp,
           'YYYY-MM-DD HH24:MI:SS'
         ) AS tracking_scanned_at,
         COALESCE(rs_first.scanned_by, r.received_by) AS tracking_scanned_by,
         staff_scan.name AS tracking_scanned_by_name,
         to_char(r.unbox_opened_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS unbox_opened_at,
         r.unbox_opened_by,
         staff_unbox_open.name AS unbox_opened_by_name,
         staff_unbox.name AS unboxed_by_name,
         staff_recv.name AS received_by_name,
         to_char(r.created_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')   AS created_at,
         to_char(r.updated_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')   AS updated_at
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       LEFT JOIN LATERAL (
         SELECT id FROM local_pickup_orders
         WHERE receiving_id = r.id AND organization_id = $2
         ORDER BY id DESC LIMIT 1
       ) lpo ON TRUE
       LEFT JOIN LATERAL (
         SELECT rs.scanned_at, rs.scanned_by
         FROM receiving_scans rs
         WHERE rs.receiving_id = r.id AND rs.organization_id = $2
         ORDER BY rs.scanned_at ASC, rs.id ASC
         LIMIT 1
       ) rs_first ON TRUE
       -- Terminal "Received" (DONE) time + receiver, aggregated over this carton's
       -- lines. NULL until at least one line is fully received (DONE) — so the
       -- Overview's "Received" row stays "—" while the carton is only unboxed.
       LEFT JOIN LATERAL (
         SELECT MAX(rl.received_done_at) AS received_done_at,
                (ARRAY_AGG(rl.received_by ORDER BY rl.received_done_at DESC NULLS LAST)
                   FILTER (WHERE rl.received_by IS NOT NULL))[1] AS received_by
         FROM receiving_lines rl
         WHERE rl.receiving_id = r.id AND rl.organization_id = $2
           AND rl.received_done_at IS NOT NULL
       ) recv_done ON TRUE
       LEFT JOIN staff staff_scan ON staff_scan.id = COALESCE(rs_first.scanned_by, r.received_by)
       LEFT JOIN staff staff_unbox_open ON staff_unbox_open.id = r.unbox_opened_by
       LEFT JOIN staff staff_unbox ON staff_unbox.id = r.unboxed_by
       LEFT JOIN staff staff_recv ON staff_recv.id = COALESCE(recv_done.received_by, r.unboxed_by)
       WHERE r.id = $1 AND r.organization_id = $2
       LIMIT 1`,
      [id, orgId],
    );
    const carton = cartonRes.rows[0];
    if (!carton) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 },
      );
    }

    const linesRes = await tenantQuery(
      orgId,
      `SELECT
         rl.id,
         rl.receiving_id,
         rl.sku,
         rl.item_name,
         rl.quantity_expected,
         rl.quantity_received,
         rlt.qa_status,
         rlt.disposition_code,
         rlt.condition_grade,
         rl.workflow_status::text                          AS workflow_status,
         rl.zoho_purchaseorder_id,
         rl.zoho_purchaseorder_number,
         rl.zoho_line_item_id,
         rl.receiving_type,
         rl.intake_type,
         rl.source_platform_pill,
         rl.location_code,
         rl.listing_reference,
         stn_line.tracking_number_raw AS tracking_number,
         rl.notes,
         to_char(rl.created_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
         to_char(rl.updated_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
       FROM receiving_lines rl
       LEFT JOIN receiving_line_testing rlt
         ON rlt.receiving_line_id = rl.id
        AND rlt.organization_id = rl.organization_id
       LEFT JOIN receiving r_cart ON r_cart.id = rl.receiving_id
       LEFT JOIN shipping_tracking_numbers stn_line ON stn_line.id = r_cart.shipment_id
       WHERE rl.receiving_id = $1 AND rl.organization_id = $2
       ORDER BY rl.id ASC`,
      [id, orgId],
    );
    const lines = linesRes.rows;

    const lineIds = lines.map((l) => Number(l.id)).filter(Number.isFinite);
    let serialsByLine = new Map<number, Array<Record<string, unknown>>>();
    if (lineIds.length > 0) {
      const serialsRes = await tenantQuery(
        orgId,
        `SELECT id, serial_number, current_status::text AS current_status,
                current_location, condition_grade::text AS condition_grade,
                origin_receiving_line_id, received_at, updated_at
         FROM serial_units
         WHERE origin_receiving_line_id = ANY($1::int[])
           AND organization_id = $2
         ORDER BY created_at ASC, id ASC`,
        [lineIds, orgId],
      );
      for (const row of serialsRes.rows) {
        const lid = Number(row.origin_receiving_line_id);
        if (!Number.isFinite(lid)) continue;
        const bucket = serialsByLine.get(lid) ?? [];
        bucket.push({
          id: row.id,
          serial_number: row.serial_number,
          current_status: row.current_status,
          current_location: row.current_location,
          condition_grade: row.condition_grade,
        });
        serialsByLine.set(lid, bucket);
      }
    }

    const enrichedLines = lines.map((l) => ({
      ...l,
      serials: serialsByLine.get(Number(l.id)) ?? [],
    }));

    // Aggregate PO list + per-PO line counts.
    const poMap = new Map<
      string,
      { zoho_purchaseorder_id: string; zoho_purchaseorder_number: string | null; line_count: number }
    >();
    for (const l of lines) {
      const pid = String(l.zoho_purchaseorder_id || '').trim();
      if (!pid) continue;
      const existing = poMap.get(pid);
      if (existing) existing.line_count += 1;
      else poMap.set(pid, {
        zoho_purchaseorder_id: pid,
        zoho_purchaseorder_number: l.zoho_purchaseorder_number || null,
        line_count: 1,
      });
    }
    const purchase_orders = Array.from(poMap.values());

    // Totals.
    const totals = lines.reduce(
      (acc, l) => {
        const expected = Number(l.quantity_expected ?? 0);
        const received = Number(l.quantity_received ?? 0);
        acc.expected += expected;
        acc.received += received;
        acc.lines += 1;
        if (expected > 0 && received >= expected) acc.lines_complete += 1;
        return acc;
      },
      { expected: 0, received: 0, lines: 0, lines_complete: 0 },
    );

    // Recent timeline for this carton — non-fatal if inventory_events is unavailable.
    let recentEvents: Awaited<ReturnType<typeof readTimeline>> = [];
    try {
      recentEvents = await readTimeline({ receiving_id: id, limit: 30 }, orgId);
    } catch (timelineErr) {
      console.warn('receiving/[id] GET: readTimeline failed (events omitted)', timelineErr);
    }

    // Enrich event subject names (staff, bin, serial).
    const staffIds = Array.from(
      new Set(recentEvents.map((e) => e.actor_staff_id).filter((v): v is number => v != null)),
    );
    const binIds = Array.from(
      new Set(
        recentEvents
          .flatMap((e) => [e.bin_id, e.prev_bin_id])
          .filter((v): v is number => v != null),
      ),
    );
    const serialIds = Array.from(
      new Set(recentEvents.map((e) => e.serial_unit_id).filter((v): v is number => v != null)),
    );

    const staffMap = new Map<number, string>();
    const binMap = new Map<number, string>();
    const serialMap = new Map<number, string>();

    if (staffIds.length > 0) {
      const r = await tenantQuery<{ id: number; name: string }>(
        orgId,
        `SELECT id, name FROM staff WHERE id = ANY($1::int[]) AND organization_id = $2`,
        [staffIds, orgId],
      );
      for (const row of r.rows) staffMap.set(row.id, row.name);
    }
    if (binIds.length > 0) {
      const r = await tenantQuery<{ id: number; name: string }>(
        orgId,
        `SELECT id, name FROM locations WHERE id = ANY($1::int[]) AND organization_id = $2`,
        [binIds, orgId],
      );
      for (const row of r.rows) binMap.set(row.id, row.name);
    }
    if (serialIds.length > 0) {
      const r = await tenantQuery<{ id: number; serial_number: string }>(
        orgId,
        `SELECT id, serial_number FROM serial_units WHERE id = ANY($1::int[]) AND organization_id = $2`,
        [serialIds, orgId],
      );
      for (const row of r.rows) serialMap.set(row.id, row.serial_number);
    }

    const events = recentEvents.map((e) => ({
      id: e.id,
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      actor_staff_id: e.actor_staff_id,
      actor_name:
        e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
      station: e.station,
      sku: e.sku,
      serial_unit_id: e.serial_unit_id,
      serial_number:
        e.serial_unit_id != null ? serialMap.get(e.serial_unit_id) ?? null : null,
      bin_id: e.bin_id,
      bin_name: e.bin_id != null ? binMap.get(e.bin_id) ?? null : null,
      prev_bin_id: e.prev_bin_id,
      prev_bin_name:
        e.prev_bin_id != null ? binMap.get(e.prev_bin_id) ?? null : null,
      prev_status: e.prev_status,
      next_status: e.next_status,
      notes: e.notes,
      payload: e.payload,
      receiving_line_id: e.receiving_line_id,
    }));

    return NextResponse.json({
      success: true,
      receiving: carton,
      purchase_orders,
      lines: enrichedLines,
      totals,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load package';
    console.error('receiving/[id] GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.mark_received');
    if (gate.denied) return gate.denied;
    const ctx = gate.ctx;
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    // Body parse with explicit failure modes. Bad/missing JSON used to silently
    // become {} → downstream "No valid fields to update" 400, which gave ops no
    // way to tell malformed JSON from a legitimately empty payload.
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json(
        { success: false, error: 'Content-Type must be application/json', received: contentType || null },
        { status: 415 },
      );
    }
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json(
          { success: false, error: 'Body must be a JSON object' },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch (err) {
      console.warn('[receiving/:id PATCH] JSON parse failed', {
        id,
        message: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(body, 'support_notes')) {
      const raw = body.support_notes;
      const next = raw == null || raw === '' ? null : String(raw).trim() || null;
      updates.push(`support_notes = $${idx++}`);
      values.push(next);
    }

    // Carton-level OVERALL Zoho note (Zoho PO header `notes`). Editable in the
    // workspace Zoho Notes tab; persisted here and pushed to Zoho when
    // `push_to_zoho` is set (Save to Zoho).
    const pushToZoho = body.push_to_zoho === true;
    let zohoNoteEdited: string | null | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_notes')) {
      const raw = body.zoho_notes;
      zohoNoteEdited = raw == null || raw === '' ? null : String(raw).trim() || null;
      updates.push(`zoho_notes = $${idx++}`);
      values.push(zohoNoteEdited);
    }
    let zohoPoIdForNotes: string | null = null;
    if (zohoNoteEdited !== undefined && pushToZoho) {
      // Resolve the PO id from the carton header OR any linked line — eBay-
      // imported cartons keep the PO id on the LINE, so a header-only lookup
      // skipped the push with `no_zoho_link`. Mirrors the per-line description
      // sync (which already reads the line), so notes now sync just like it.
      zohoPoIdForNotes = await resolveCartonZohoPoId(ctx.organizationId, id);
    }

    // Carton-level listing URL (sourced from Zoho PO parse or operator input
    // on the receiving page). Same trim+nullify pattern as support_notes so
    // explicit clears land as NULL rather than empty strings.
    if (Object.prototype.hasOwnProperty.call(body, 'listing_url')) {
      const raw = body.listing_url;
      const next = raw == null || raw === '' ? null : String(raw).trim() || null;
      updates.push(`listing_url = $${idx++}`);
      values.push(next);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'source_platform')) {
      const raw = body.source_platform;
      const next = raw == null || raw === '' ? null : String(raw).trim().toLowerCase();
      if (next != null) {
        // Union the hardcoded built-ins (incl. internal 'zoho') with the org's
        // catalog slugs so custom platforms are accepted; never narrower than
        // the legacy allowlist. See docs/platform-account-type-catalog-plan.md.
        const allowed = new Set([
          ...SOURCE_PLATFORMS,
          ...(await getOrgPlatforms(ctx.organizationId)).map((p) => p.slug),
        ]);
        if (!allowed.has(next)) {
          return NextResponse.json(
            { success: false, error: `Invalid source_platform. Allowed: ${Array.from(allowed).join(', ')}` },
            { status: 400 },
          );
        }
      }
      updates.push(`source_platform = $${idx++}`);
      values.push(next);
    }

    // Return flag (receiving.is_return). Coerced to a strict boolean so a
    // stringified 'false' / 0 from a form never lands as truthy.
    if (Object.prototype.hasOwnProperty.call(body, 'is_return')) {
      const raw = body.is_return;
      const next = raw === true || raw === 'true' || raw === 1 || raw === '1';
      updates.push(`is_return = $${idx++}`);
      values.push(next);
    }

    // Return-platform tag (receiving.return_platform). Validated against the
    // return_platform vocabulary (return_platform_enum); '' / null clears it.
    // Mirrors the source_platform handler block above.
    if (Object.prototype.hasOwnProperty.call(body, 'return_platform')) {
      const raw = body.return_platform;
      const next = raw == null || raw === '' ? null : String(raw).trim().toUpperCase();
      if (next != null && !RETURN_PLATFORMS.has(next)) {
        return NextResponse.json(
          { success: false, error: `Invalid return_platform. Allowed: ${Array.from(RETURN_PLATFORMS).join(', ')}` },
          { status: 400 },
        );
      }
      updates.push(`return_platform = $${idx++}`);
      values.push(next);
    }

    // Carton-level default receiving type (PO|RETURN|TRADE_IN + org custom).
    // Per-line receiving_lines.receiving_type overrides this; null clears it.
    if (Object.prototype.hasOwnProperty.call(body, 'intake_type')) {
      const raw = body.intake_type;
      const next = raw == null || raw === '' ? null : String(raw).trim().toUpperCase();
      if (next != null) {
        const allowed = new Set([
          ...INTAKE_TYPES,
          ...(await getOrgTypes(ctx.organizationId)).map((t) => t.slug.toUpperCase()),
        ]);
        if (!allowed.has(next)) {
          return NextResponse.json(
            { success: false, error: `Invalid intake_type. Allowed: ${Array.from(allowed).join(', ')}` },
            { status: 400 },
          );
        }
      }
      updates.push(`intake_type = $${idx++}`);
      values.push(next);

      // Dual-write the normalized catalog link (receiving.type_id) alongside the
      // intake_type text cache — Phase 2, migration 2026-06-14f. Guarded by the
      // cached column probe so this is a no-op until the migration is applied
      // (the text column stays the cache; readers migrate to type_id later).
      const { columns } = await getReceivingSchema();
      if (columns.has('type_id')) {
        let typeId: number | null = null;
        if (next != null) {
          const slug = next.toLowerCase();
          typeId = (await getOrgTypes(ctx.organizationId)).find((t) => t.slug.toLowerCase() === slug)?.id ?? null;
        }
        updates.push(`type_id = $${idx++}`);
        values.push(typeId);
      }
    }

    // PO# linkage — writing either field with a non-null value flips
    // `source` to 'zoho_po' so the carton drops off the Unfound queue.
    // The repair-service link flow only writes _number (Ecwid order #),
    // so the auto-upgrade must also fire for that branch.
    let poWrittenNonNull = false;
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_purchaseorder_id')) {
      const raw = body.zoho_purchaseorder_id;
      const next = raw == null || raw === '' ? null : String(raw).trim();
      updates.push(`zoho_purchaseorder_id = $${idx++}`);
      values.push(next);
      if (next) poWrittenNonNull = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_purchaseorder_number')) {
      const raw = body.zoho_purchaseorder_number;
      const next = raw == null || raw === '' ? null : String(raw).trim();
      updates.push(`zoho_purchaseorder_number = $${idx++}`);
      values.push(next);
      if (next) poWrittenNonNull = true;
    }
    if (poWrittenNonNull) {
      // Only upgrade 'unmatched' → 'zoho_po'. Never downgrade.
      updates.push(`source = CASE WHEN source = 'zoho_po' THEN source ELSE 'zoho_po' END`);
    }

    // Optional tracking link — register the tracking number via the shipping
    // backbone (idempotent) and stamp the returned shipment_id on this row.
    let registeredShipmentId: number | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'reference_number')
     || Object.prototype.hasOwnProperty.call(body, 'tracking_number')) {
      const rawTracking = body.reference_number ?? body.tracking_number;
      const trackingStr = rawTracking == null ? '' : String(rawTracking).trim();
      if (trackingStr) {
        const shipment = await registerShipmentPermissive({
          trackingNumber: trackingStr,
          sourceSystem: 'receiving.link-po',
        }, ctx.organizationId);
        if (shipment?.id) {
          registeredShipmentId = Number(shipment.id);
          updates.push(`shipment_id = $${idx++}`);
          values.push(registeredShipmentId);
          // Tracking lives solely in STN (shipment_id) — legacy
          // receiving_tracking_number has been dropped.
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);
    const orgParamIdx = values.push(ctx.organizationId);

    // Snapshot + UPDATE in one GUC-scoped transaction so the audit diff and the
    // write see the same tenant. The UPDATE carries an explicit org predicate
    // (defense in depth alongside RLS); a row owned by another org never matches.
    const { before, result } = await withTenantTransaction(ctx.organizationId, async (client) => {
      // Snapshot the row before the update so the audit row carries a real diff.
      const beforeRow = await client.query(
        `SELECT id, source_platform, intake_type, is_return, return_platform,
                zoho_purchaseorder_id, zoho_purchaseorder_number,
                shipment_id, support_notes, listing_url, source
         FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [id, ctx.organizationId],
      );
      const before = beforeRow.rows[0] ?? null;

      const result = await client.query<{
        id: number;
        source_platform: string | null;
        intake_type: string | null;
        is_return: boolean | null;
        return_platform: string | null;
        zoho_purchaseorder_id: string | null;
        zoho_purchaseorder_number: string | null;
        shipment_id: number | null;
        support_notes: string | null;
        listing_url: string | null;
      }>(
        `UPDATE receiving SET ${updates.join(', ')}
         WHERE id = $${values.length - 1} AND organization_id = $${orgParamIdx}
         RETURNING id, source_platform, intake_type, is_return, return_platform, zoho_purchaseorder_id, zoho_purchaseorder_number, shipment_id, support_notes, listing_url`,
        values,
      );
      return { before, result };
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({
      organizationId: ctx.organizationId,
      action: 'update',
      rowId: String(id),
      source: 'receiving.patch',
    });

    await recordAudit(pool, ctx, request, {
      source: 'receiving.id.patch',
      action: AUDIT_ACTION.RECEIVING_HEADER_UPDATE,
      entityType: AUDIT_ENTITY.RECEIVING,
      entityId: id,
      before,
      after: result.rows[0],
      method: 'manual',
    });

    let zoho:
      | Awaited<ReturnType<typeof syncPoHeaderNotesToZoho>>
      | undefined;
    if (zohoNoteEdited !== undefined && pushToZoho) {
      zoho = await syncPoHeaderNotesToZoho({
        zohoPoId: zohoPoIdForNotes,
        notes: zohoNoteEdited ?? null,
      });
      after(async () => {
        try { await invalidateCacheTags(['receiving-lines', 'receiving-logs']); } catch { /* best-effort */ }
      });
      if (!zoho.ok && !zoho.skipped) {
        return NextResponse.json(
          {
            success: false,
            error: zoho.error || 'Zoho PO notes update failed',
            receiving: result.rows[0],
            zoho_notes: zohoNoteEdited,
            zoho,
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      receiving: result.rows[0],
      ...(zoho != null ? { zoho_notes: zohoNoteEdited, zoho } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update receiving';
    console.error('receiving/[id] PATCH failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
