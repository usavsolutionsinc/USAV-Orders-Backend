import { NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged, publishReturnPendingTest, publishOrderReadyShip } from '@/lib/realtime/publish';
import {
  assertPurchaseOrderLineItemsEditable,
  assertPurchaseOrderReceivable,
  buildPurchaseOrderLineItemsForDescriptionPut,
  catalogItemIdFromZohoPoLineItem,
  createPurchaseReceive,
  getPurchaseOrderById,
  searchItemBySku,
  updatePurchaseOrder,
} from '@/lib/zoho';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { upsertSerialUnit } from '@/lib/neon/serial-units-queries';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { transition } from '@/lib/inventory/state-machine';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getReceivingDefaultPutawayBin } from '@/lib/settings/accessors';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  isPlacementParityObserve,
  isPlacementStrangleReceivingPutaway,
} from '@/lib/feature-flags';
import { observePlacementParity } from '@/lib/workflow/placement-parity';
import { resolveSitePlacementBin } from '@/lib/workflow/placement-policy';
import type { PlacementResolverDeps } from '@/lib/workflow/placement';
import { receivingDefaultPutawayPolicy } from '@/lib/receiving/putaway-placement';

// Default putaway bin (cached per Function instance). When the receive
// caller doesn't supply destination_bin_id, mark-received falls back to
// the UNSORTED bin so the unit still progresses RECEIVED → STOCKED. Without
// this, units pile up at RECEIVED and the picker has nothing to allocate.
// See migration 2026-05-21_inventory_v2_unsorted_default_bin.sql.
// Per-org cache (bins are tenant-owned, so the default bin id differs per org).
// Cache key is `${orgId}:${barcode}` so an org changing its default-putaway-bin
// setting (Settings Registry `receiving.defaultPutawayBin`) busts the cache.
const cachedDefaultPutawayBinId = new Map<string, number | null>();

/**
 * The org's default-putaway bin BARCODE (Settings Registry
 * `receiving.defaultPutawayBin` → RECEIVING_DEFAULT_PUTAWAY_BIN_BARCODE env →
 * 'UNSORTED'). Extracted so the legacy resolver AND the declarative placement
 * policy (the strangle) read the symbol from one source and can't drift.
 */
async function defaultPutawayBarcode(orgId: string): Promise<string> {
  const org = await getOrganization(orgId as OrgId);
  return org
    ? getReceivingDefaultPutawayBin(org.settings, process.env.RECEIVING_DEFAULT_PUTAWAY_BIN_BARCODE)
    : (process.env.RECEIVING_DEFAULT_PUTAWAY_BIN_BARCODE || 'UNSORTED').trim();
}

/** A bin lookup that mirrors resolveDefaultPutawayBinId's filter (RESERVE + active),
 *  so the placement mechanism resolves the SAME bin the legacy path would. */
function reserveBinDeps(orgId: string): PlacementResolverDeps {
  const find = async (barcode: string): Promise<{ id: number; name: string } | null> => {
    const r = await tenantQuery<{ id: number; name: string }>(
      orgId,
      `SELECT id, name FROM locations
        WHERE barcode = $1
          AND is_active = true
          AND bin_role = 'RESERVE'
          AND organization_id = $2
        ORDER BY id ASC
        LIMIT 1`,
      [barcode, orgId],
    );
    return r.rows[0] ?? null;
  };
  return { findByBarcode: find, findByName: async () => null };
}

async function resolveDefaultPutawayBinId(orgId: string): Promise<number | null> {
  const barcode = await defaultPutawayBarcode(orgId);
  const cacheKey = `${orgId}:${barcode}`;
  if (cachedDefaultPutawayBinId.has(cacheKey)) return cachedDefaultPutawayBinId.get(cacheKey)!;
  let resolved: number | null = null;
  try {
    const r = await tenantQuery<{ id: number }>(
      orgId,
      `SELECT id FROM locations
        WHERE barcode = $1
          AND is_active = true
          AND bin_role = 'RESERVE'
          AND organization_id = $2
        ORDER BY id ASC
        LIMIT 1`,
      [barcode, orgId],
    );
    resolved = r.rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[mark-received] default-putaway bin lookup failed for barcode=${barcode}:`, err);
    resolved = null;
  }
  cachedDefaultPutawayBinId.set(cacheKey, resolved);
  return resolved;
}

/**
 * Directed-putaway suggestion (receiving-triage streamline Phase 4b). SKU
 * affinity: send the unit to the active bin where this SKU was last put away,
 * so like stock consolidates instead of scattering into UNSORTED. Returns null
 * when the SKU has no prior putaway (caller falls back to the UNSORTED default).
 * Only consulted when the operator didn't scan an explicit destination bin.
 */
async function suggestPutawayBinIdForSku(sku: string | null, orgId: string): Promise<number | null> {
  if (!sku) return null;
  try {
    const r = await tenantQuery<{ bin_id: number }>(
      orgId,
      `SELECT ie.bin_id
         FROM inventory_events ie
        WHERE ie.sku = $1
          AND ie.event_type = 'PUTAWAY'
          AND ie.bin_id IS NOT NULL
          AND ie.organization_id = $2
          AND EXISTS (
            SELECT 1 FROM locations l
             WHERE l.id = ie.bin_id AND l.is_active = true
          )
        ORDER BY ie.id DESC
        LIMIT 1`,
      [sku, orgId],
    );
    return r.rows[0]?.bin_id ?? null;
  } catch (err) {
    console.warn(`[mark-received] putaway SKU-affinity lookup failed for sku=${sku}:`, err);
    return null;
  }
}

/**
 * Receive-event overlay: emit inventory_events (RECEIVED + optional PUTAWAY)
 * and append a sku_stock_ledger row, all in one transaction. The serial_units
 * row itself is created by the caller via the canonical upsertSerialUnit and
 * its id is passed in as `serialUnitId` (we reuse it; the raw upsert here is
 * only a defensive fallback). Runs as a best-effort overlay after the serial
 * and line writes have committed.
 *
 * Inputs already validated by the caller (qtyReceived > 0, receivingLineId
 * exists, dispositionCode in the enum). Returns the inserted event/ledger
 * ids for the response payload.
 */
async function applyInventoryV2Effects(input: {
  /** Tenant scope — stamped on the serial_units fallback upsert so the per-org natural key resolves. */
  organizationId: string;
  receivingId: number | null;
  receivingLineId: number;
  sku: string | null;
  qtyReceived: number;
  serialNumber: string | null;
  /**
   * Pre-resolved serial_units.id from the caller's canonical upsertSerialUnit
   * (unit_uid mint + return-detection + metadata). When set, we reuse it and
   * skip the raw upsert below so the canonical row isn't clobbered back to
   * RECEIVED (which would erase a detected return). Null only for qty-only
   * receives with no serial.
   */
  serialUnitId: number | null;
  /**
   * True when the canonical writer detected this serial as a return (it was
   * previously SHIPPED). Suppresses the sellable +qty ledger row and the
   * auto-putaway-to-STOCKED transition so the unit stays RETURNED for QC.
   */
  isReturn: boolean;
  zohoItemId: string | null;
  conditionGrade: string;
  dispositionCode: string;
  destinationBinId: number | null;
  staffId: number;
  clientEventId: string | null;
  notes: string | null;
  nowPst: string;
}): Promise<{ ledgerId: number | null; receivedEventId: number; putawayEventId: number | null; serialUnitId: number | null }> {
  return withTenantTransaction(input.organizationId, async (client) => {
    // 1. Serial unit. Normally the caller already created it via the canonical
    //    upsertSerialUnit and passed the id in — reuse it. The raw upsert below
    //    is a defensive fallback for a serial that somehow arrived without a
    //    pre-resolved id; it mirrors the legacy SQL and additionally sets
    //    current_location when a destination bin is provided.
    let serialUnitId: number | null = input.serialUnitId ?? null;
    if (serialUnitId == null && input.serialNumber) {
      const upsert = await client.query<{ id: number }>(
        `INSERT INTO serial_units (
          serial_number, normalized_serial, sku, zoho_item_id,
          current_status, current_location, origin_source,
          origin_receiving_line_id, received_at, received_by, condition_grade,
          organization_id
        )
        VALUES ($1, UPPER(TRIM($1)), $2, $3, 'RECEIVED'::serial_status_enum,
                $8, 'receiving', $4, $5, $6, $7::condition_grade_enum, $9::uuid)
        ON CONFLICT (organization_id, normalized_serial) DO UPDATE SET
          current_status = 'RECEIVED'::serial_status_enum,
          current_location = COALESCE(EXCLUDED.current_location, serial_units.current_location),
          received_at = EXCLUDED.received_at,
          received_by = EXCLUDED.received_by,
          condition_grade = EXCLUDED.condition_grade,
          sku = COALESCE(serial_units.sku, EXCLUDED.sku),
          updated_at = NOW()
        RETURNING id`,
        [
          input.serialNumber,
          input.sku,
          input.zohoItemId,
          input.receivingLineId,
          input.nowPst,
          input.staffId > 0 ? input.staffId : null,
          input.conditionGrade,
          input.destinationBinId != null ? String(input.destinationBinId) : null,
          input.organizationId,
        ],
      );
      serialUnitId = upsert.rows[0]?.id ?? null;
    }

    // 2. sku_stock_ledger row — only for ACCEPT disposition with qty.
    //    The trg_sku_stock_from_ledger trigger will project the new
    //    on-hand count back onto sku_stock.stock automatically. Skipped for
    //    returns: a returned unit isn't fresh sellable stock until it's graded.
    let ledgerId: number | null = null;
    if (
      input.sku &&
      input.qtyReceived > 0 &&
      input.dispositionCode === 'ACCEPT' &&
      !input.isReturn
    ) {
      const ledger = await client.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger (
          sku, delta, reason, dimension, staff_id,
          ref_serial_unit_id, ref_receiving_line_id, notes, organization_id
        )
        VALUES ($1, $2, 'RECEIVED', 'WAREHOUSE', $3, $4, $5, $6, $7::uuid)
        RETURNING id`,
        [
          input.sku,
          input.qtyReceived,
          input.staffId > 0 ? input.staffId : null,
          serialUnitId,
          input.receivingLineId,
          input.notes,
          input.organizationId,
        ],
      );
      ledgerId = ledger.rows[0]?.id ?? null;
    }

    // 3. inventory_events RECEIVED — always emitted on the flagged path
    //    so the lifecycle timeline reflects every intake even when
    //    qty=0 or disposition=SCRAP/RTV.
    const receivedClientEventId = input.clientEventId
      ? `${input.clientEventId}:RECEIVED`
      : null;
    const receivedEvent = await client.query<{ id: number }>(
      `INSERT INTO inventory_events (
        event_type, actor_staff_id, station,
        receiving_id, receiving_line_id, serial_unit_id, sku,
        bin_id, prev_status, next_status, stock_ledger_id,
        client_event_id, notes, payload, organization_id
      )
      VALUES ('RECEIVED', $1, 'RECEIVING',
              $2, $3, $4, $5,
              $6, NULL, 'RECEIVED', $7,
              $8, $9, $10::jsonb, $11::uuid)
      ON CONFLICT (client_event_id) DO NOTHING
      RETURNING id`,
      [
        input.staffId > 0 ? input.staffId : null,
        input.receivingId,
        input.receivingLineId,
        serialUnitId,
        input.sku,
        input.destinationBinId,
        ledgerId,
        receivedClientEventId,
        input.notes,
        JSON.stringify({
          condition_grade: input.conditionGrade,
          disposition_code: input.dispositionCode,
          qty_received: input.qtyReceived,
        }),
        input.organizationId,
      ],
    );
    // If conflict swallowed the insert, look up the existing row.
    let receivedEventId = receivedEvent.rows[0]?.id;
    if (receivedEventId == null && receivedClientEventId) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM inventory_events WHERE client_event_id = $1 AND organization_id = $2 LIMIT 1`,
        [receivedClientEventId, input.organizationId],
      );
      receivedEventId = existing.rows[0]?.id;
    }
    if (receivedEventId == null) {
      throw new Error('applyInventoryV2Effects: failed to insert or resolve RECEIVED event');
    }

    // 4. inventory_events PUTAWAY — only when a destination bin is
    //    provided AND the unit is accepted. Skipped for SCRAP/RTV so
    //    those events don't imply the unit reached stock, and skipped for
    //    returns so a detected return stays RETURNED (QC queue) instead of
    //    being force-transitioned to STOCKED.
    let putawayEventId: number | null = null;
    if (input.destinationBinId != null && input.dispositionCode === 'ACCEPT' && !input.isReturn) {
      const putawayClientEventId = input.clientEventId
        ? `${input.clientEventId}:PUTAWAY`
        : null;
      if (serialUnitId) {
        // Serialized putaway: route the RECEIVED→STOCKED change through the
        // guarded transition(), which emits the PUTAWAY event (with receiving /
        // bin / stock-ledger linkage carried via the passthrough fields) atomic
        // with the status write. transition() writes status only, so the bin
        // location is set in a follow-up UPDATE. Best-effort: a guard rejection
        // (unit not RECEIVED — e.g. an already-stocked re-scan) leaves the unit
        // as-is rather than force-stocking it.
        const t = await transition({
          unitId: serialUnitId,
          to: 'STOCKED',
          eventType: 'PUTAWAY',
          actorStaffId: input.staffId > 0 ? input.staffId : null,
          station: 'RECEIVING',
          clientEventId: putawayClientEventId,
          expectedFrom: 'RECEIVED',
          receivingId: input.receivingId,
          receivingLineId: input.receivingLineId,
          stockLedgerId: ledgerId,
          binId: input.destinationBinId,
          payload: { qty: input.qtyReceived, condition_grade: input.conditionGrade },
        }, client);
        if (t.ok) {
          putawayEventId = t.eventId;
          await client.query(
            `UPDATE serial_units SET current_location = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
            [String(input.destinationBinId), serialUnitId, input.organizationId],
          );
        } else {
          console.warn(`mark-received putaway: STOCKED transition skipped for unit ${serialUnitId}: ${t.error}`);
        }
      } else {
        // Qty-only putaway (no serialized unit): emit the informational PUTAWAY
        // event directly — there is no unit to transition.
        const putawayEvent = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
            event_type, actor_staff_id, station,
            receiving_id, receiving_line_id, serial_unit_id, sku,
            bin_id, prev_status, next_status, stock_ledger_id,
            client_event_id, payload, organization_id
          )
          VALUES ('PUTAWAY', $1, 'RECEIVING',
                  $2, $3, $4, $5,
                  $6, 'RECEIVED', 'STOCKED', $7,
                  $8, $9::jsonb, $10::uuid)
          ON CONFLICT (client_event_id) DO NOTHING
          RETURNING id`,
          [
            input.staffId > 0 ? input.staffId : null,
            input.receivingId,
            input.receivingLineId,
            serialUnitId,
            input.sku,
            input.destinationBinId,
            ledgerId,
            putawayClientEventId,
            JSON.stringify({
              qty: input.qtyReceived,
              condition_grade: input.conditionGrade,
            }),
            input.organizationId,
          ],
        );
        putawayEventId = putawayEvent.rows[0]?.id ?? null;
      }
    }

    return { ledgerId, receivedEventId, putawayEventId, serialUnitId };
  });
}

export const POST = withAuth(async (request, ctx) => {
  try {
    const body = await request.json();
    const receivingLineId = Number(body?.receiving_line_id);
    const receivingId = body?.receiving_id != null ? Number(body.receiving_id) : null;
    const zohoPoId = String(body?.zoho_purchaseorder_id || '').trim();
    const zohoLineItemId = String(body?.zoho_line_item_id || '').trim();
    const zohoItemId = String(body?.zoho_item_id || '').trim();
    const qaStatus = String(body?.qa_status || 'PASSED').trim();
    const dispositionCode = String(body?.disposition_code || 'ACCEPT').trim();
    const conditionGrade = String(body?.condition_grade || 'USED_A').trim();
    const serialNumber = String(body?.serial_number || '').trim() || null;
    const zendeskTicket = String(body?.zendesk_ticket || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;
    // Optional destination bin
    // scanned at the same time as the receive action. Triggers a PUTAWAY
    // event + serial_units.current_location update inside the same txn.
    // When the caller omits destination_bin_id on an ACCEPT receive, fall
    // back to the UNSORTED default bin so the unit still reaches STOCKED.
    const destinationBinIdRaw = body?.destination_bin_id;
    let destinationBinId =
      Number.isFinite(Number(destinationBinIdRaw)) && Number(destinationBinIdRaw) > 0
        ? Math.floor(Number(destinationBinIdRaw))
        : null;
    // True only when the operator scanned an explicit bin. When false we may
    // upgrade the default to a directed SKU-affinity suggestion below (Phase 4b).
    const binExplicit = destinationBinId != null;
    let putawayBinSource: 'operator' | 'sku_affinity' | 'default' | null = binExplicit
      ? 'operator'
      : null;
    if (destinationBinId == null && dispositionCode === 'ACCEPT') {
      const legacyBinId = await resolveDefaultPutawayBinId(ctx.organizationId);
      destinationBinId = legacyBinId;
      putawayBinSource = 'default';

      // Placement strangle (§1.6 Track 1): the default-putaway bin choice is a
      // disposition→bin decision. Only do the (extra) policy work when a
      // placement flag is on — otherwise this is the untouched legacy path.
      if (isPlacementStrangleReceivingPutaway() || isPlacementParityObserve()) {
        const barcode = await defaultPutawayBarcode(ctx.organizationId);
        const policy = receivingDefaultPutawayPolicy(barcode);
        const binDeps = reserveBinDeps(ctx.organizationId);

        // CUTOVER: resolve from the declarative policy (org Studio rules → system
        // default), via the RESERVE+active lookup, falling back to the legacy bin.
        if (isPlacementStrangleReceivingPutaway()) {
          const resolved = await resolveSitePlacementBin({
            orgId: ctx.organizationId,
            facts: { disposition: 'ACCEPT' },
            systemPolicy: policy,
            binDeps,
          });
          if (resolved) {
            destinationBinId = resolved.bin.binId;
            putawayBinSource = 'default';
          }
        }

        // OBSERVE-ONLY: prove the mechanism resolves the same bin as the legacy
        // path. Fire-and-forget + self-guarded — never disturbs the receive.
        void observePlacementParity({
          site: 'receiving-default-putaway',
          orgId: ctx.organizationId,
          facts: { disposition: 'ACCEPT' },
          rules: policy,
          expected: legacyBinId != null ? { binId: legacyBinId, binName: barcode } : null,
          deps: binDeps,
        });
      }
    }
    // Idempotency token from the client (mobile scanner generates a UUID
    // per scan). Optional; unique within inventory_events.
    const clientEventId = String(body?.client_event_id || '').trim() || null;
    // Server-trusted actor from the verified session cookie. The wrapper
    // guarantees ctx.staffId is set on this permission-gated route.
    const staffId = ctx.staffId;

    // Resolve a human-readable staff name for Zoho payloads. Prefer the
    // value the client sent, then fall back to a DB lookup, and only as a
    // last resort show "Staff #<id>" — that fallback should be rare now
    // since every paired session is tied to a real staff row.
    let staffName = String(body?.staff_name || '').trim();
    if (!staffName && staffId != null && Number.isFinite(staffId) && staffId > 0) {
      try {
        const staffLookup = await tenantQuery<{ name: string | null }>(
          ctx.organizationId,
          `SELECT name FROM staff WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [staffId, ctx.organizationId],
        );
        staffName = (staffLookup.rows[0]?.name || '').trim();
      } catch { /* silent — fall through to generic label */ }
    }
    if (!staffName) {
      staffName = staffId != null && Number.isFinite(staffId) && staffId > 0 ? `Staff #${staffId}` : 'Unknown';
    }

    if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
      return NextResponse.json({ success: false, error: 'receiving_line_id is required' }, { status: 400 });
    }

    // Validate destination bin exists before we commit anything else. The
    // previous behavior was to fail silently inside applyInventoryV2Effects,
    // leaving the line received but the bin assignment skipped. Bin storage
    // lives in `locations` (see inventory_events.bin_id FK).
    if (destinationBinId != null) {
      const binCheck = await tenantQuery<{ id: number }>(
        ctx.organizationId,
        `SELECT id FROM locations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [destinationBinId, ctx.organizationId],
      );
      if (binCheck.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'BIN_NOT_FOUND', destination_bin_id: destinationBinId },
          { status: 404 },
        );
      }
    }

    const now = formatPSTTimestamp();

    const hasZohoReceive = Boolean(zohoPoId && zohoLineItemId);

    // Capture before-state for audit_logs diff.
    const beforeRes = await tenantQuery(
      ctx.organizationId,
      `SELECT quantity_received, quantity_expected, workflow_status, qa_status,
              disposition_code, condition_grade
         FROM receiving_lines WHERE id = $1 AND organization_id = $2`,
      [receivingLineId, ctx.organizationId],
    );
    const beforeRow = (beforeRes.rows as Array<{
      quantity_received: number | null;
      quantity_expected: number | null;
      workflow_status: string | null;
      qa_status: string | null;
      disposition_code: string | null;
      condition_grade: string | null;
    }>)[0] ?? null;

    // 1. Update the line locally. When Zoho receive is required, sit at
    //    UNBOXED (physically processed, Zoho receive pending) until
    //    createPurchaseReceive succeeds; then we set DONE. UNBOXED — not
    //    MATCHED — so a Zoho-pending line can't be mistaken for (or re-queued
    //    as) a merely door-scanned carton.
    const lineUpdate = await tenantQuery(
      ctx.organizationId,
      `UPDATE receiving_lines
       SET qa_status = $1,
           disposition_code = $2,
           condition_grade = $3,
           notes = $4,
           workflow_status = CASE
             WHEN $6 THEN 'UNBOXED'::inbound_workflow_status_enum
             ELSE 'DONE'::inbound_workflow_status_enum
           END,
           quantity_received = GREATEST(
             COALESCE(quantity_received, 0),
             COALESCE(quantity_expected, 1)
           )
       WHERE id = $5 AND organization_id = $7
       RETURNING *`,
      [qaStatus, dispositionCode, conditionGrade, notes, receivingLineId, hasZohoReceive, ctx.organizationId],
    );

    if (lineUpdate.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    let line = lineUpdate.rows[0];
    const qtyReceived = Number(line.quantity_received) || 1;
    let zohoReceiveOk = !hasZohoReceive;
    let zohoReceiveError: string | null = null;

    // Phase 4b: directed putaway. When the operator didn't scan an explicit bin
    // and we'd otherwise dump the unit in UNSORTED, send it to the bin this SKU
    // was last put away in (consolidates like stock). Only on ACCEPT + flag on.
    if (
      !binExplicit &&
      dispositionCode === 'ACCEPT' &&
      (line.sku ?? null)
    ) {
      const affinityBin = await suggestPutawayBinIdForSku(line.sku ?? null, ctx.organizationId);
      if (affinityBin != null) {
        destinationBinId = affinityBin;
        putawayBinSource = 'sku_affinity';
      }
    }

    // 2. Serial/stock/event writes.
    //
    //  a) When a serial was scanned, create/advance the serial_units row through
    //     the CANONICAL writer first. This owns its own txn and is the single
    //     source of status-transition/return-detection, metadata, and unit_uid
    //     minting (when the SKU is cataloged) — identical to every other
    //     serial_units birth in the system. A failure here crashes the receive
    //     (500), exactly as the legacy path did, rather than silently dropping
    //     the unit. We hand the resolved id to the overlay below so it links its
    //     events/ledger to this row instead of re-inserting and clobbering a
    //     detected return back to RECEIVED.
    //  b) Then emit RECEIVED + optional PUTAWAY inventory_events and append a
    //     sku_stock_ledger row in one txn (best-effort overlay). See
    //     applyInventoryV2Effects() above.
    let serialUnitId: number | null = null;
    // A previously-SHIPPED serial coming back through the receiving door is a
    // RETURN, not a fresh intake. The canonical writer detects this and lands
    // the unit in RETURNED. We must NOT then auto-putaway it to STOCKED or add
    // a sellable +qty ledger row — it belongs in the returns/QC queue until a
    // human grades it. isReturn carries that signal into the overlay below.
    let isReturn = false;
    if (serialNumber) {
      const serialResult = await upsertSerialUnit({
        serial_number: serialNumber,
        sku: line.sku ?? null,
        zoho_item_id: zohoItemId || null,
        origin_source: 'receiving',
        origin_receiving_line_id: receivingLineId,
        actor_id: staffId != null && staffId > 0 ? staffId : null,
        condition_grade: conditionGrade,
        target_status: 'RECEIVED',
        location: destinationBinId != null ? String(destinationBinId) : null,
      }, undefined, ctx.organizationId);
      serialUnitId = serialResult?.unit.id ?? null;
      isReturn = serialResult?.is_return ?? false;
    }

    let v2Effects: Awaited<ReturnType<typeof applyInventoryV2Effects>> | null = null;
    try {
      v2Effects = await applyInventoryV2Effects({
        organizationId: ctx.organizationId,
        receivingId,
        receivingLineId,
        sku: line.sku ?? null,
        qtyReceived,
        serialNumber,
        serialUnitId,
        isReturn,
        zohoItemId: zohoItemId || null,
        conditionGrade,
        dispositionCode,
        destinationBinId,
        staffId: staffId ?? 0,
        clientEventId,
        notes,
        nowPst: now,
      });
    } catch (err) {
      // Best-effort overlay. The serial row (a) and the line update have already
      // committed, so we log and continue rather than crashing the receive. An
      // admin can replay via /api/inventory-events.
      console.warn('mark-received: applyInventoryV2Effects failed', err);
    }

    // 3. Update receiving row unboxed_at if set. Capture whether THIS call is the
    // one that newly unboxed the carton (COALESCE keeps an existing timestamp),
    // plus the carton flags, so the tech-station inbox is nudged exactly once.
    if (receivingId) {
      const cartonUpd = await tenantQuery<{ is_return: boolean | null; is_priority: boolean | null; just_unboxed: boolean; tracking: string | null }>(
        ctx.organizationId,
        `UPDATE receiving SET unboxed_at = COALESCE(unboxed_at, $1),
                              unboxed_by = COALESCE(unboxed_by, $2),
                              updated_at = $1
          WHERE id = $3 AND organization_id = $4
          RETURNING is_return, is_priority,
                    (unboxed_at = $1) AS just_unboxed,
                    (SELECT s.tracking_number_raw FROM shipping_tracking_numbers s
                      WHERE s.id = receiving.shipment_id) AS tracking`,
        [now, staffId, receivingId, ctx.organizationId],
      ).catch(() => null);
      const carton = cartonUpd?.rows?.[0];
      if (carton?.just_unboxed) {
        after(async () => {
          try {
            if (carton.is_return) {
              await publishReturnPendingTest({
                organizationId: ctx.organizationId,
                receivingId,
                trackingNumber: carton.tracking,
                source: 'receiving.mark-received',
              });
            } else if (carton.is_priority) {
              await publishOrderReadyShip({
                organizationId: ctx.organizationId,
                receivingId,
                trackingNumber: carton.tracking,
                source: 'receiving.mark-received',
              });
            }
          } catch (err) {
            console.warn('mark-received: tech-inbox notify failed', err);
          }
        });
      }
    }

    // Resolve tracking# for the reference_number push. Prefer the canonical
    // shipping_tracking_numbers row via receiving.shipment_id; fall back to
    // receiving.receiving_tracking_number. Computed before the Zoho receive call.
    let localTracking: string | null = null;
    let trackingShipmentId: number | null = null;
    if (receivingId) {
      try {
        const trackingRes = await tenantQuery<{
          tracking: string | null;
          shipment_id: number | null;
        }>(
          ctx.organizationId,
          `SELECT stn.tracking_number_raw AS tracking,
                  r.shipment_id
             FROM receiving r
             LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
            WHERE r.id = $1 AND r.organization_id = $2
            LIMIT 1`,
          [receivingId, ctx.organizationId],
        );
        localTracking = (trackingRes.rows[0]?.tracking || '').trim() || null;
        trackingShipmentId = trackingRes.rows[0]?.shipment_id ?? null;
      } catch { /* silent — Zoho push will just skip */ }
    }

    // Backfill shipment_id when this receiving row arrived via /lookup-po
    // before the shipping_tracking_numbers row existed (or as a Zoho
    // 'unmatched' carry-forward that never got linked). Without this, a
    // second scan of the same tracking is forced to recreate state and the
    // exception triage worker keeps re-finding the row as "orphaned."
    if (receivingId && trackingShipmentId == null && localTracking) {
      try {
        const shipment = await registerShipmentPermissive({
          trackingNumber: localTracking,
          sourceSystem: 'receiving.mark-received',
        }, ctx.organizationId);
        if (shipment?.id) {
          await tenantQuery(
            ctx.organizationId,
            `UPDATE receiving
                SET shipment_id = $1, updated_at = NOW()
              WHERE id = $2 AND shipment_id IS NULL AND organization_id = $3`,
            [shipment.id, receivingId, ctx.organizationId],
          );
        }
      } catch (err) {
        console.warn('[mark-received] shipment_id backfill failed', {
          receiving_id: receivingId,
          tracking: localTracking,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 4. Zoho purchase receive (await before responding). PO notes/serials only after receive succeeds.
    if (hasZohoReceive) {
      try {
        const poResp = await getPurchaseOrderById(zohoPoId);
        assertPurchaseOrderReceivable(poResp);
        let catalogId = zohoItemId && zohoItemId.length > 0 ? zohoItemId : '';
        if (!catalogId) {
          const items = poResp.purchaseorder?.line_items || [];
          for (const raw of items) {
            if (!raw || typeof raw !== 'object') continue;
            const li = raw as unknown as Record<string, unknown>;
            const id = String(li.line_item_id ?? li.id ?? '').trim();
            if (id !== zohoLineItemId) continue;
            catalogId = catalogItemIdFromZohoPoLineItem(raw) || '';
            break;
          }
        }
        if (!catalogId && line.sku) {
          try {
            const hit = await searchItemBySku(String(line.sku));
            catalogId = hit?.item_id ? String(hit.item_id).trim() : '';
          } catch {
            catalogId = '';
          }
        }
        if (!catalogId) {
          throw new Error(
            `Cannot resolve Zoho catalog item_id for PO line ${zohoLineItemId}.`,
          );
        }
        await createPurchaseReceive({
          purchaseOrderId: zohoPoId,
          lineItems: [
            {
              line_item_id: zohoLineItemId,
              quantity_received: qtyReceived,
              item_id: catalogId,
            },
          ],
          bills: poResp.purchaseorder?.bills,
        });
        zohoReceiveOk = true;
        const doneUp = await tenantQuery(
          ctx.organizationId,
          `UPDATE receiving_lines
             SET workflow_status = 'DONE'::inbound_workflow_status_enum,
                 updated_at = NOW()
           WHERE id = $1 AND organization_id = $2
           RETURNING *`,
          [receivingLineId, ctx.organizationId],
        );
        if (doneUp.rows[0]) line = doneUp.rows[0];

        try {
          const existing = await getPurchaseOrderById(zohoPoId);
          const patch: Record<string, unknown> = {};

          if (serialNumber) {
            try {
              assertPurchaseOrderLineItemsEditable(existing);
              if (existing.purchaseorder) {
                const built = buildPurchaseOrderLineItemsForDescriptionPut(
                  existing.purchaseorder,
                  { [zohoLineItemId]: `SN: ${serialNumber.trim()}` },
                );
                if (built.length > 0) {
                  patch.line_items = built;
                }
              }
            } catch (e) {
              console.warn('mark-received: Zoho PO line description skipped', e);
            }
          }

          const poHeader = (existing?.purchaseorder || {}) as Record<string, unknown>;
          const currentRef = String(poHeader.reference_number || '').trim();
          const currentNotes = String(poHeader.notes || '');

          if (localTracking && currentRef !== localTracking) {
            patch.reference_number = localTracking;
          }

          const noteLead: string[] = [`${staffName} ${now}`];
          if (zendeskTicket) noteLead.push(`Zendesk: ${zendeskTicket}`);
          const noteHead = noteLead.join(' · ');
          const noteTail = [
            ...(serialNumber ? [`SN: ${serialNumber}`] : []),
            ...(notes ? [`Notes: ${notes}`] : []),
          ].join(' | ');
          const newLine = noteTail ? `${noteHead} · ${noteTail}` : noteHead;

          if (!currentNotes.includes(newLine)) {
            patch.notes = currentNotes ? `${newLine}\n${currentNotes}` : newLine;
          }

          if (Object.keys(patch).length > 0) {
            await updatePurchaseOrder(zohoPoId, patch);
          }
        } catch (err) {
          console.warn('mark-received: updatePurchaseOrder sync failed', err);
        }
      } catch (err) {
        // Inventory side already committed (line update + v2Effects). Zoho is
        // now out of sync — the response carries `zoho_receive_ok:false` +
        // error so the client can surface "Pending Zoho sync" and an admin
        // can replay. Logged at ERROR level so monitoring picks it up;
        // existing inventory_events are still authoritative on our side.
        zohoReceiveOk = false;
        zohoReceiveError = err instanceof Error ? err.message : String(err);
        console.error('[mark-received] createPurchaseReceive failed — inventory committed, Zoho pending', {
          receiving_line_id: receivingLineId,
          receiving_id: receivingId,
          zoho_po_id: zohoPoId,
          zoho_line_item_id: zohoLineItemId,
          qty_received: qtyReceived,
          serial_number: serialNumber ?? null,
          message: zohoReceiveError,
        });
      }
    }

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-logs', 'receiving-lines', 'serial-units']);
        await publishReceivingLogChanged({
          organizationId: ctx.organizationId,
          action: 'update',
          rowId: String(receivingLineId),
          source: 'receiving.mark-received',
        });
      } catch (err) {
        console.warn('mark-received: cache/realtime failed', err);
      }
    });

    const workflowStatus =
      String(line.workflow_status ?? '').trim() || (hasZohoReceive ? 'UNBOXED' : 'DONE');

    await recordAudit(pool, ctx, request, {
      source: 'receiving-station',
      action: AUDIT_ACTION.PO_RECEIVE,
      entityType: AUDIT_ENTITY.RECEIVING_LINE,
      entityId: receivingLineId,
      before: beforeRow
        ? {
            quantity_received: beforeRow.quantity_received,
            quantity_expected: beforeRow.quantity_expected,
            workflow_status: beforeRow.workflow_status,
            qa_status: beforeRow.qa_status,
            disposition_code: beforeRow.disposition_code,
            condition_grade: beforeRow.condition_grade,
          }
        : null,
      after: {
        quantity_received: line.quantity_received,
        quantity_expected: line.quantity_expected,
        workflow_status: workflowStatus,
        qa_status: line.qa_status,
        disposition_code: line.disposition_code,
        condition_grade: line.condition_grade,
      },
      method: serialNumber ? 'scan' : 'manual',
      extra: {
        receiving_id: receivingId,
        zoho_purchaseorder_id: zohoPoId || null,
        zoho_line_item_id: zohoLineItemId || null,
        zoho_synced: zohoReceiveOk,
        ...(serialNumber ? { serial_number: serialNumber } : {}),
        ...(zendeskTicket ? { zendesk_ticket: zendeskTicket } : {}),
        ...(zohoReceiveError ? { zoho_error: zohoReceiveError } : {}),
      },
    });

    return NextResponse.json({
      success: zohoReceiveOk,
      receiving_line_id: receivingLineId,
      workflow_status: workflowStatus,
      zoho_synced: zohoReceiveOk,
      ...(zohoReceiveError ? { zoho_error: zohoReceiveError } : {}),
      receiving_line: line,
      ...(v2Effects
        ? {
            inventory_v2: {
              received_event_id: v2Effects.receivedEventId,
              putaway_event_id: v2Effects.putawayEventId,
              stock_ledger_id: v2Effects.ledgerId,
              serial_unit_id: v2Effects.serialUnitId,
            },
            // Phase 4b: where the unit was directed and why (operator scan,
            // SKU affinity, or the UNSORTED default), so the UI can confirm it.
            putaway: { bin_id: destinationBinId, source: putawayBinSource },
          }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark as received';
    console.error('receiving/mark-received POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });
