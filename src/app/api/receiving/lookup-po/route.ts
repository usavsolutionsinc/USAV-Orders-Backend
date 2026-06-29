import { NextRequest, NextResponse, after } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { formatPSTTimestamp } from '@/utils/date';
import { getCarrier, extractCanonicalTracking } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged, publishPriorityUnbox } from '@/lib/realtime/publish';
import { searchPurchaseOrdersByTracking, searchPurchaseReceivesByTracking, findPurchaseOrderByNumber } from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import { ensureSkuCatalogEntry } from '@/lib/neon/sku-catalog-queries';
import { findPendingOrderSkuMatches } from '@/lib/receiving/pending-order-match';
import {
  isIntakeClassification,
  classificationToColumns,
  type IntakeClassification,
} from '@/lib/receiving/intake-classification';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { isReceivingUnifiedInbound } from '@/lib/feature-flags';
import { recordReceivingScan } from '@/lib/receiving/record-scan';
import { resolveShipmentForScan } from '@/lib/receiving/resolve-shipment-for-scan';
import type { ReceivingExceptionCode } from '@/lib/receiving/exception-codes';
import {
  upsertOpenTrackingException,
  resolveReceivingExceptionsByReceivingId,
} from '@/lib/tracking-exceptions';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

// ── Zoho error classification ────────────────────────────────────────────────
// Distinguishes "Zoho replied, no match" from "Zoho is unreachable." The former
// is normal traffic; the latter is an outage we want to alert on.
function zohoErrStatus(err: unknown): number | null {
  const status = (err as { status?: number; statusCode?: number; response?: { status?: number } } | null)
    ?.status
    ?? (err as { statusCode?: number } | null)?.statusCode
    ?? (err as { response?: { status?: number } } | null)?.response?.status
    ?? null;
  return typeof status === 'number' ? status : null;
}
function zohoErrCode(err: unknown): string | null {
  const code = (err as { code?: string } | null)?.code ?? null;
  return typeof code === 'string' ? code : null;
}
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A PO line-item import that fails because the org's Zoho integration is not
 * connected (no vault row AND no legacy bridge) throws CredentialNotConnectedError
 * (code 'CREDENTIAL_NOT_CONNECTED'). Detect it so the carton response can say
 * "Zoho not connected" instead of silently coming back matched-but-empty, which
 * the client renders as "No PO found". Checked by code so we stay decoupled from
 * the error class across the async boundary.
 */
function isCredentialNotConnected(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'CREDENTIAL_NOT_CONNECTED';
}

/**
 * Which of this carton's line SKUs are needed by a currently-pending order.
 * Read-only enhancement — never fails the scan; on error returns [].
 */
async function computePendingOrderSkus(
  organizationId: string,
  lines: ReadonlyArray<{ sku: string | null; zoho_item_id: string | null }>,
): Promise<string[]> {
  try {
    return await findPendingOrderSkuMatches(
      organizationId,
      lines.map((l) => l.sku),
      lines.map((l) => l.zoho_item_id),
    );
  } catch (err) {
    console.warn('lookup-po: pending-order match failed', errMessage(err));
    return [];
  }
}

/**
 * Persist the shared unbox/test urgency flag when a door-scanned carton matches
 * a SKU a pending order needs. This is the durable half of the priority_unbox
 * signal: the Ably push nudges the unboxer live, while receiving.is_priority
 * floats the carton to rank-0 in the Prioritize rail AND the tester's queue
 * (RECEIVING_PRIORITY_RANK_SQL) so "urgent to unbox" carries through to test.
 * Idempotent + best-effort — a failure here never blocks the scan response.
 */
async function markReceivingPriority(receivingId: number | null, orgId: string): Promise<void> {
  if (!receivingId || !Number.isFinite(receivingId)) return;
  try {
    await tenantQuery(
      orgId,
      // Pending-order match = top urgency: set the manual override to tier 0
      // (Priority) and keep is_priority in lockstep. Idempotent — skip rows
      // already at the top tier.
      `UPDATE receiving SET is_priority = true, priority_tier = 0, updated_at = NOW()
        WHERE id = $1 AND (priority_tier IS DISTINCT FROM 0 OR is_priority = false)`,
      [receivingId],
    );
  } catch (err) {
    console.warn('lookup-po: markReceivingPriority failed', errMessage(err));
  }
}

function isZohoNoMatch(err: unknown): boolean {
  const status = zohoErrStatus(err);
  // 4xx (except 401/403/429) generally means Zoho parsed the request and
  // returned a non-fatal "nothing here." Auth + rate-limit = outage-like.
  if (status == null) return false;
  if (status === 401 || status === 403 || status === 429) return false;
  return status >= 400 && status < 500;
}

async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<void> {
  const queue = items.slice();
  const workers = new Array(Math.min(limit, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) return;
      try {
        await fn(next);
      } catch {
        /* per-item failures are non-fatal for warmup */
      }
    }
  });
  await Promise.all(workers);
}

interface ReceivingLineLite {
  id: number;
  sku: string | null;
  zoho_item_id: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  item_name: string | null;
  image_url: string | null;
}

async function fetchLines(receivingId: number, orgId: string): Promise<ReceivingLineLite[]> {
  const result = await tenantQuery<ReceivingLineLite>(
    orgId,
    `SELECT rl.id, rl.sku, rl.zoho_item_id, rl.zoho_purchaseorder_id,
            rl.quantity_expected, rl.quantity_received, rl.item_name,
            sc.image_url
     FROM receiving_lines rl
     LEFT JOIN sku_catalog sc ON sc.sku = rl.sku
     WHERE rl.receiving_id = $1
     ORDER BY rl.id ASC`,
    [receivingId],
  );
  return result.rows;
}

interface ReceivingPackage {
  received_at: string | null;
  unboxed_at: string | null;
  created_at: string | null;
  return_platform: string | null;
  source_platform: string | null;
  is_return: boolean;
}

async function fetchReceivingPackage(receivingId: number, orgId: string): Promise<ReceivingPackage | null> {
  const r = await tenantQuery<ReceivingPackage>(
    orgId,
    `SELECT received_at::text AS received_at,
            unboxed_at::text AS unboxed_at,
            created_at::text AS created_at,
            return_platform::text AS return_platform,
            source_platform,
            COALESCE(is_return, false) AS is_return
     FROM receiving
     WHERE id = $1
     LIMIT 1`,
    [receivingId],
  );
  return r.rows[0] ?? null;
}

/**
 * Audit + memoize a successful lookup match. Every successful STN resolution
 * writes a `receiving_scans` row so we have a full event log AND so future
 * identical-byte scans hit the cheap `receiving_scans` fallback path.
 *
 * Distinct from the full `recordScan` below (which captures carrier + staff
 * during the main scan flow) — this is the minimal audit during lookup.
 */
async function memoizeLookupHit(
  receivingId: number,
  trackingNumber: string,
  receivingSource: string,
  staffId: number | null,
  carrier: string,
): Promise<number> {
  const scanSource: 'zoho_po' | 'unmatched' = receivingSource === 'zoho_po' ? 'zoho_po' : 'unmatched';
  return recordReceivingScan(receivingId, trackingNumber, carrier, staffId, scanSource);
}

/**
 * Resolve an inbound carrier scan to a local `receiving` row WITHOUT calling
 * Zoho. Authoritative source is `shipping_tracking_numbers` (STN) joined to
 * `receiving` via `receiving.shipment_id`. Zoho webhooks populate STN, so
 * once webhooks are live, this function handles almost every scan locally.
 *
 * Matching is delegated to `resolveShipmentForScan`, which prefers STN's EXACT
 * `tracking_number_normalized` key (UNIQUE → one physical package) and only
 * falls back to last-8 — with a log — on an exact miss. Last-8 is lossy (15
 * live collision groups), so it must stay a fallback, not the primary key. See
 * docs/new-additions/tracking-canonicalization-stn-plan.md §3.2.
 *
 * Order of attempts:
 *   1. STN exact-normalized ⋈ receiving (then last-8 fallback, logged).
 *   2. `receiving_scans` — fallback for rows where `shipment_id` is NULL
 *      (unmatched walk-in scans / pre-webhook legacy data).
 *
 * Ambiguity (≥2 distinct receiving rows on the same last-8 suffix) drops to
 * Zoho where the PO header can disambiguate.
 */
async function findScanByTracking(
  trackingNumber: string,
  staffId: number | null,
  carrier: string,
  orgId: string,
): Promise<{ scan_id: number; receiving_id: number } | null> {
  // ── 1. STN exact-normalized (last-8 demoted to a logged fallback) ────────
  const resolved = await resolveShipmentForScan(trackingNumber, orgId);
  if (resolved.receivingId != null) {
    const scan_id = await memoizeLookupHit(
      resolved.receivingId,
      trackingNumber,
      resolved.receivingSource ?? 'unmatched',
      staffId,
      carrier,
    );
    return { scan_id, receiving_id: resolved.receivingId };
  }

  // ── 2. receiving_scans fallback (STN-less rows) ─────────────────────────
  const digits = String(trackingNumber || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const last8 = digits.slice(-8);
  const scanHit = await tenantQuery<{ scan_id: number; receiving_id: number }>(
    orgId,
    `SELECT id AS scan_id, receiving_id
       FROM receiving_scans
      WHERE RIGHT(regexp_replace(tracking_number, '\\D', '', 'g'), 8) = $1
      ORDER BY id DESC
      LIMIT 2`,
    [last8],
  );
  if (scanHit.rows.length === 1) return scanHit.rows[0];

  return null;
}

/**
 * Order# / PO-reference resolution against the LOCAL incoming mirror — no Zoho.
 * The incoming Zoho sync already materializes receiving_lines (workflow
 * EXPECTED, receiving_id NULL) and a zoho_po_mirror header for every issued PO,
 * so an order number an operator is unboxing is almost always already local.
 * Matches the shared `_norm` (upper + strip non-alphanumeric) on the
 * receiving_lines PO#, then the mirror PO#/reference#. Returns the Zoho PO id.
 */
async function resolvePoIdLocally(orderNumber: string, orgId: string): Promise<string | null> {
  const norm = orderNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!norm) return null;
  // Tenant-scoped via the GUC pool: receiving_lines + zoho_po_mirror are FORCEd,
  // so RLS constrains resolution to THIS org — a scanned order# can never resolve
  // to another tenant's PO id (the cross-org leak this previously had on the
  // BYPASSRLS owner pool).
  // 1. receiving_lines (the Incoming table) — newest wins.
  const rl = await tenantQuery<{ zoho_purchaseorder_id: string }>(
    orgId,
    `SELECT zoho_purchaseorder_id
       FROM receiving_lines
      WHERE zoho_purchaseorder_number_norm = $1
        AND zoho_purchaseorder_id IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`,
    [norm],
  );
  if (rl.rows[0]?.zoho_purchaseorder_id) return String(rl.rows[0].zoho_purchaseorder_id);
  // 2. zoho_po_mirror — by PO number, else by reference number.
  const m = await tenantQuery<{ zoho_purchaseorder_id: string }>(
    orgId,
    `SELECT zoho_purchaseorder_id
       FROM zoho_po_mirror
      WHERE zoho_purchaseorder_number_norm = $1
         OR NULLIF(upper(regexp_replace(COALESCE(reference_number, ''), '[^A-Za-z0-9]', '', 'g')), '') = $1
      ORDER BY last_synced_at DESC NULLS LAST
      LIMIT 1`,
    [norm],
  );
  return m.rows[0]?.zoho_purchaseorder_id ? String(m.rows[0].zoho_purchaseorder_id) : null;
}

/**
 * Tracking → PO id resolution against LOCAL data only — no Zoho. The incoming
 * Zoho sync (zoho-receiving-sync.ts) registers each PO's Reference# (the
 * tracking, per the inbound contract) into shipping_tracking_numbers, pre-creates
 * a `zoho_po` receiving row stamped with the zoho_purchaseorder_id, and writes
 * its lines as EXPECTED (receiving_id NULL). So a tracking scan of an
 * incoming-but-unscanned PO can be turned into its PO id entirely locally:
 *   1. the receiving row findScanByTracking already resolved via STN
 *      (preassigned) carries the PO id directly, or
 *   2. the zoho_po_mirror header whose Reference# canonical-matches this tracking.
 * Returning a PO id here lets the matched path adopt the pre-materialized local
 * lines and SKIP the live Zoho tracking search — the "Opening your PO" latency.
 */
async function resolvePoIdLocallyByTracking(
  trackingNumber: string,
  preassignedReceivingId: number | null,
  orgId: string,
): Promise<string | null> {
  // 1. Authoritative: the STN-resolved receiving row already holds the PO id
  //    (the incoming sync stamped source='zoho_po', zoho_purchaseorder_id).
  if (preassignedReceivingId != null) {
    const r = await tenantQuery<{ zoho_purchaseorder_id: string | null }>(
      orgId,
      `SELECT zoho_purchaseorder_id FROM receiving
        WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [preassignedReceivingId, orgId],
    );
    const poId = r.rows[0]?.zoho_purchaseorder_id;
    if (poId) return String(poId);
  }
  // 2. Fallback: zoho_po_mirror header whose Reference# carries this tracking.
  //    Exact canonical match only (no lossy last-8) — Reference# isn't always a
  //    tracking, so a suffix collision could open the wrong PO.
  const canon = trackingNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!canon) return null;
  const m = await tenantQuery<{ zoho_purchaseorder_id: string }>(
    orgId,
    `SELECT zoho_purchaseorder_id
       FROM zoho_po_mirror
      WHERE NULLIF(upper(regexp_replace(COALESCE(reference_number, ''), '[^A-Za-z0-9]', '', 'g')), '') = $1
      ORDER BY last_synced_at DESC NULLS LAST
      LIMIT 1`,
    [canon],
  );
  return m.rows[0]?.zoho_purchaseorder_id ? String(m.rows[0].zoho_purchaseorder_id) : null;
}

/**
 * Verify a resolved PO id actually carries the scanned PO#/reference. Guards the
 * order-mode local resolution against a normalized-number collision or a
 * mis-synced receiving_line that points at the WRONG purchaseorder_id — without
 * this, scanning one PO# could open a different PO. Checks the authoritative
 * zoho_po_mirror header for that id.
 *   'match'    → the mirror confirms this id carries the scanned number/reference
 *   'mismatch' → the mirror knows this id and it carries a DIFFERENT number
 *   'unknown'  → the mirror has no header for this id (can't disprove; trust it)
 */
async function verifyPoNumberMatches(
  poId: string,
  orderNumber: string,
  orgId: string,
): Promise<'match' | 'mismatch' | 'unknown'> {
  const norm = orderNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!norm) return 'unknown';
  const { rows } = await tenantQuery<{ matches: boolean }>(
    orgId,
    `SELECT (
              zoho_purchaseorder_number_norm = $2
              OR NULLIF(upper(regexp_replace(COALESCE(reference_number, ''), '[^A-Za-z0-9]', '', 'g')), '') = $2
            ) AS matches
       FROM zoho_po_mirror
      WHERE zoho_purchaseorder_id = $1
      LIMIT 1`,
    [poId, norm],
  );
  if (rows.length === 0) return 'unknown';
  return rows[0].matches ? 'match' : 'mismatch';
}

/**
 * Adopt the pre-existing local receiving_lines for a PO onto the carton being
 * unboxed — the local equivalent of importZohoPurchaseOrderToReceiving, WITHOUT
 * a Zoho round-trip (the lines already exist from the incoming sync). Only takes
 * unattached lines (receiving_id IS NULL); lines already on another carton are
 * left alone. `updated_at` is trigger-maintained. Returns the count adopted.
 */
async function linkLocalPoLinesToReceiving(poId: string, receivingId: number, orgId: string): Promise<number> {
  // Tenant-scoped: only adopt THIS org's unattached lines. receiving_lines is
  // FORCEd, so under the GUC pool RLS guarantees the UPDATE can never pull
  // another tenant's lines onto this carton (the prior owner-pool cross-org
  // adoption leak).
  const res = await tenantQuery(
    orgId,
    `UPDATE receiving_lines
        SET receiving_id = $1,
            workflow_status = CASE WHEN workflow_status = 'EXPECTED' THEN 'MATCHED' ELSE workflow_status END
      WHERE zoho_purchaseorder_id = $2
        AND receiving_id IS NULL`,
    [receivingId, poId],
  );
  await stampInboundHandlingUnit(receivingId, orgId);
  return res.rowCount ?? 0;
}

/**
 * Phase 3 (unified inbound) — assign the carton an LPN and propagate the
 * receiving row's shipment_id down to its lines, so a delivered shipment
 * resolves its line-level SKU/order# directly (delivered-unscanned surface) and
 * the carton has a stable plate. Column-gated by RECEIVING_UNIFIED_INBOUND:
 * a no-op (and never touches the new columns) until the migration is applied
 * and the flag is flipped, so an unapplied migration can't error here.
 */
async function stampInboundHandlingUnit(receivingId: number, orgId: string): Promise<void> {
  if (!isReceivingUnifiedInbound()) return;
  try {
    await tenantQuery(
      orgId,
      `UPDATE receiving SET lpn = 'RC-' || id::text WHERE id = $1 AND lpn IS NULL`,
      [receivingId],
    );
    await tenantQuery(
      orgId,
      `UPDATE receiving_lines rl
          SET shipment_id = r.shipment_id
         FROM receiving r
        WHERE rl.receiving_id = $1
          AND r.id = $1
          AND r.shipment_id IS NOT NULL
          AND rl.shipment_id IS DISTINCT FROM r.shipment_id`,
      [receivingId],
    );
  } catch (err) {
    // Never fail a scan over the handling-unit stamp — it's an enrichment.
    console.warn(`[lookup-po] stampInboundHandlingUnit failed for receiving=${receivingId}:`, err);
  }
}

async function upsertMatchedReceiving(
  poId: string,
  carrier: string,
  staffId: number | null,
  organizationId: string,
): Promise<{ receivingId: number; preexisting: boolean }> {
  const now = formatPSTTimestamp();
  const result = await tenantQuery<{ id: number; xmax: string }>(
    organizationId,
    `INSERT INTO receiving
       (source, zoho_purchaseorder_id, carrier, receiving_date_time,
        received_at, received_by, qa_status, needs_test, updated_at, organization_id)
     VALUES ('zoho_po', $1, $2, $3::timestamp, $3::timestamptz, $4, 'PENDING', true, $3::timestamptz, $5::uuid)
     ON CONFLICT (zoho_purchaseorder_id) WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL
     DO UPDATE SET
       updated_at = EXCLUDED.updated_at,
       -- The Incoming Zoho sync pre-creates this PO's zoho_po receiving row with
       -- received_at NULL (see zoho-receiving-sync.ts). The door scan IS the
       -- physical-arrival event, so stamp received_at/by on first scan even when
       -- the row already existed — otherwise the matched carton never satisfies
       -- the view=scanned predicate (r.received_at IS NOT NULL) and stays
       -- invisible in the Prioritize / unbox Queue feeds. COALESCE keeps the
       -- original scan time + scanner on re-scans (idempotent, never resets).
       received_at = COALESCE(receiving.received_at, EXCLUDED.received_at),
       received_by = COALESCE(receiving.received_by, EXCLUDED.received_by),
       carrier = COALESCE(receiving.carrier, EXCLUDED.carrier),
       organization_id = COALESCE(receiving.organization_id, EXCLUDED.organization_id)
     RETURNING id, xmax::text`,
    [poId, carrier || null, now, staffId, organizationId],
  );
  const row = result.rows[0];
  return { receivingId: Number(row.id), preexisting: row.xmax !== '0' };
}

async function createUnmatchedReceiving(
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
  organizationId: string,
): Promise<{ receivingId: number; shipmentId: number | null }> {
  const now = formatPSTTimestamp();
  const shipment = await registerShipmentPermissive({
    trackingNumber,
    sourceSystem: 'receiving_lookup_po',
  }, organizationId);
  // Stamp organization_id explicitly rather than leaning on the column default
  // (the GUC default is NULL on this raw-pool path). Receiving is a tenant-owned
  // table; an unmatched door-scan must land under the scanning operator's org.
  const result = await tenantQuery<{ id: number }>(
    organizationId,
    `INSERT INTO receiving
       (source, shipment_id, carrier, receiving_date_time,
        received_at, received_by, qa_status, needs_test, updated_at, organization_id)
     VALUES ('unmatched', $1, $2, $3::timestamp, $3::timestamptz, $4, 'PENDING', true, $3::timestamptz, $5::uuid)
     RETURNING id`,
    [shipment?.id ?? null, carrier || null, now, staffId, organizationId],
  );
  const receivingId = Number(result.rows[0].id);
  // Phase 5: tag the OS&D reason. No carrier resolved → CARRIER_MISMATCH;
  // otherwise it's a scanned box with no matching PO → NO_PO.
  const exceptionCode: ReceivingExceptionCode =
    !carrier || carrier.trim().toUpperCase() === 'UNKNOWN' ? 'CARRIER_MISMATCH' : 'NO_PO';
  await stampReceivingException(receivingId, exceptionCode, organizationId);
  return {
    receivingId,
    shipmentId: shipment?.id ?? null,
  };
}

/**
 * Best-effort OS&D reason stamp (Phase 5). Tolerant of the column not existing
 * yet (pre-migration) — a failure here must never break a scan, so it warns and
 * returns. Once 2026-06-08_receiving_exception_code is applied it persists.
 */
async function stampReceivingException(
  receivingId: number,
  code: ReceivingExceptionCode,
  orgId: string,
): Promise<void> {
  try {
    await tenantQuery(orgId, `UPDATE receiving SET exception_code = $2 WHERE id = $1`, [receivingId, code]);
  } catch (err) {
    console.warn(`[lookup-po] exception_code stamp skipped for receiving=${receivingId}:`, err);
  }
}

// ── Test / demo shortcut ─────────────────────────────────────────────────────
// A tracking that starts with "TEST" (e.g. TEST123) skips Zoho and instantly
// creates a matched test carton + one line, so the door-scan → unbox flow can
// be exercised end-to-end without a real PO. Fully idempotent: re-scanning
// returns the same carton/line and NEVER resets unbox progress — the line
// insert is ON CONFLICT DO NOTHING, and received_at/unboxed_at are each only
// set once (received_at on first scan, unboxed_at via mark-received's COALESCE).
const TEST_TRACKING_RE = /^TEST/i;

function isTestTracking(tracking: string): boolean {
  return TEST_TRACKING_RE.test(tracking.trim());
}

/** Stable synthetic PO id for a test tracking, e.g. "TEST123" → "TEST-PO-TEST123". */
function testPoIdFor(trackingNumber: string): string {
  const key =
    trackingNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32) || 'TEST';
  return `TEST-PO-${key}`;
}

async function createOrGetTestReceiving(
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
  organizationId: string,
): Promise<{ receivingId: number; scanId: number; preexisting: boolean; poId: string }> {
  const poId = testPoIdFor(trackingNumber);
  const key = poId.slice('TEST-PO-'.length);
  const zohoItemId = `TEST-ITEM-${key}`;
  const zohoLineItemId = `TEST-LINE-${key}`;

  const { receivingId, preexisting } = await upsertMatchedReceiving(poId, carrier, staffId, organizationId);
  const scanId = await recordReceivingScan(receivingId, trackingNumber, carrier, staffId, 'zoho_po');

  // A scanned test carton belongs in receiving triage as a SCANNED line — NOT
  // the tech testing queue. The testing queue (/api/work-orders) keys on the
  // receiving HEADER's needs_test, which upsertMatchedReceiving sets true for
  // real POs; clear it here (also heals an older test carton on re-scan).
  await tenantQuery(organizationId, `UPDATE receiving SET needs_test = false WHERE id = $1`, [receivingId]);

  // DO NOTHING on conflict so a re-scan can't wipe the quantity_received /
  // workflow_status the unbox step wrote (order-independence of scan vs unbox).
  // needs_test=false: a scanned test carton is a SCANNED receiving line (lands
  // in the receiving triage page, workflow_status MATCHED → "SCANNED" label) —
  // NOT a testing work-order. The tech testing queue keys on needs_test=true
  // (work-orders route), so flagging it there is what wrongly pulled the test
  // carton into the testing display queue instead of receiving triage.
  await tenantQuery(
    organizationId,
    `INSERT INTO receiving_lines
       (receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchaseorder_id,
        item_name, sku, quantity_expected, quantity_received, workflow_status,
        qa_status, disposition_code, condition_grade, needs_test, updated_at, organization_id)
     VALUES ($1, $2, $3, $4, $5, 'TEST-SKU', 1, 0, 'MATCHED',
        'PENDING', 'HOLD', 'BRAND_NEW', false, NOW(), $6::uuid)
     ON CONFLICT (zoho_purchaseorder_id, zoho_line_item_id)
       WHERE zoho_purchaseorder_id IS NOT NULL AND zoho_line_item_id IS NOT NULL
     -- Heal only needs_test on re-scan (clears any older test carton wrongly
     -- flagged for testing) WITHOUT touching quantity_received / workflow_status,
     -- so unbox progress survives a re-scan.
     DO UPDATE SET needs_test = false`,
    [receivingId, zohoItemId, zohoLineItemId, poId, `Test item · ${key}`, organizationId],
  );

  return { receivingId, scanId, preexisting, poId };
}

async function recordScan(
  receivingId: number,
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
  source: 'zoho_po' | 'unmatched',
): Promise<number> {
  return recordReceivingScan(receivingId, trackingNumber, carrier, staffId, source);
}

/**
 * Persist the door operator's intake classification onto the carton's
 * `receiving` row (source_platform / is_return / return_platform). The single
 * mapping lives in intake-classification.ts. No-op for UNKNOWN so an un-tagged
 * scan never clobbers an existing classification. This is what lets the door
 * "set FBA Return once, scan the pallet" flow reach the unboxer's context card.
 */
async function applyIntakeClassification(
  receivingId: number | null,
  classification: IntakeClassification | null,
  orgId: string,
): Promise<void> {
  if (!receivingId || !classification || classification === 'UNKNOWN') return;
  const cols = classificationToColumns(classification);
  await tenantQuery(
    orgId,
    `UPDATE receiving
        SET source_platform = $2, is_return = $3, return_platform = $4, updated_at = NOW()
      WHERE id = $1`,
    [receivingId, cols.source_platform, cols.is_return, cols.return_platform],
  );
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const rawTracking = String(body?.trackingNumber || '').trim();
    const providedCarrier = String(body?.carrier || '').trim();
    // Scan route: 'order' resolves a Zoho PO / reference number (local mirror
    // first), 'tracking' (default) resolves a carrier tracking number.
    // Scan route. 'order' = explicit PO/reference (operator armed PO# mode);
    // 'tracking' = explicit carrier tracking (operator armed Tracking mode);
    // 'auto' (default for an un-armed scan) = resolve the value as EITHER a PO#
    // or a tracking# — try PO#-exact (local→Zoho) and tracking (local→Zoho), and
    // only create an unfound carton when every identity misses. 'auto' is what
    // stops a dashless PO# from being misread as a tracking and dumped in Unfound.
    const mode: 'tracking' | 'order' | 'auto' =
      body?.mode === 'order' ? 'order' : body?.mode === 'auto' ? 'auto' : 'tracking';
    // localOnly: resolve from LOCAL data only and never block on a live Zoho
    // search. The client sends this for the FIRST scan (both modes) so the
    // carton resolves instantly — matched (local mirror / incoming) or unfound —
    // with NO "Opening your PO" loader. On a local miss the route returns
    // `zoho_pending: true` and the client fires a normal (Zoho) follow-up, which
    // is the ONLY phase that shows the loader. Order mode: a local miss returns
    // not-found+zoho_pending instead of synchronously hitting Zoho. Tracking
    // mode: an unfound localOnly result still creates the unfound carton and the
    // client's background Zoho call promotes it in place (findScanByTracking →
    // preassigned path below).
    const localOnly = body?.localOnly === true;
    // Canonicalize carrier scans at the ingestion boundary so a scanned GS1/"96"
    // FedEx barcode (e.g. 9632…382141152045) and a pasted human number
    // (382141152045) — and the Zoho reference# they reconcile against — all land
    // on ONE identical value for storage, display, dedup, and Zoho search. Only
    // in tracking mode: an order-mode value is a PO/reference number, not a
    // carrier barcode, so it must reach findPurchaseOrderByNumber untouched.
    // PO#/reference resolution matches against the RAW scanned value (untouched);
    // carrier-tracking resolution matches against the canonical form. In `auto`
    // the same scan is tried as both, so canonicalize for tracking+auto and keep
    // the raw value for the PO# phase via `poLookupValue`.
    const poLookupValue = rawTracking;
    const trackingNumber =
      mode === 'order' ? rawTracking : extractCanonicalTracking(rawTracking) || rawTracking;
    // Optional door-intake classification (e.g. 'FBA_RETURN'). Maps to the
    // carton's source_platform/is_return/return_platform so the unboxer sees it.
    const classification: IntakeClassification | null = isIntakeClassification(body?.classification)
      ? body.classification
      : null;
    // Server-trusted actor from the verified session cookie.
    const staffId = ctx.staffId;

    if (!trackingNumber) {
      return NextResponse.json(
        { success: false, error: 'trackingNumber is required' },
        { status: 400 },
      );
    }

    const carrier =
      providedCarrier && providedCarrier !== 'Unknown'
        ? providedCarrier
        : getCarrier(trackingNumber);

    // 0. ORDER# mode — resolve a PO / reference number to its receiving carton.
    //    LOCAL incoming mirror first (the PO is almost always already in the
    //    Incoming table, so we adopt its existing lines with no Zoho round-trip);
    //    live Zoho only as a fallback for a PO not yet synced. Runs before the
    //    tracking dedup/Zoho path so an order number that happens to be mostly
    //    digits can't be misread as a tracking suffix.
    if (mode === 'order' || mode === 'auto') {
      let poId = await resolvePoIdLocally(poLookupValue, ctx.organizationId);
      let resolvedVia: 'local' | 'zoho' = 'local';
      // Guard the local hit: a normalized-number collision or a mis-synced
      // receiving_line can point at the WRONG purchaseorder_id and open a
      // different PO than the one scanned. Drop the local id when the mirror
      // says it carries a different number, then fall through to the exact
      // Zoho lookup below.
      if (poId) {
        const verdict = await verifyPoNumberMatches(poId, poLookupValue, ctx.organizationId).catch((err) => {
          console.warn('[lookup-po.order] local verify failed', errMessage(err));
          return 'unknown' as const;
        });
        if (verdict === 'mismatch') {
          console.warn(
            `[lookup-po.order] local resolve for "${poLookupValue}" pointed at PO ${poId} with a different number — re-resolving via Zoho`,
          );
          poId = null;
        }
      }
      // `auto` also tries the value as a tracking# against LOCAL data (the
      // zoho_po_mirror Reference# → PO id), so an un-armed tracking scan that is
      // already a known incoming PO resolves here with no loader, exactly like a
      // PO# scan. Order mode skips this — an armed PO# is never a tracking.
      if (!poId && mode === 'auto') {
        const localByTracking = await resolvePoIdLocallyByTracking(
          trackingNumber,
          null,
          ctx.organizationId,
        ).catch(() => null);
        if (localByTracking) {
          poId = localByTracking;
          resolvedVia = 'local';
        }
      }
      if (!poId && localOnly) {
        // Instant local phase: the value isn't in local data yet (cron may not
        // have imported it). Report a clean not-found WITHOUT touching Zoho so
        // the scan stays loader-free; the client re-calls without localOnly (the
        // only loader-bearing phase), which runs the exact Zoho lookup below and
        // re-pings in case the cron just imported the PO. No carton is created.
        return NextResponse.json({
          success: true,
          matched: false,
          po_matched: false,
          not_found: true,
          zoho_pending: true,
          po_ids: [],
        });
      }
      if (!poId) {
        // A PO/reference scan must EXACT-match against Zoho — never adopt a
        // fuzzily-similar PO. Using the tolerant tracking search here returned
        // the wrong PO (first fuzzy `search_text` hit, unverified).
        const po = await findPurchaseOrderByNumber(poLookupValue).catch((err) => {
          console.warn('[lookup-po.order] zoho lookup failed', errMessage(err));
          return null;
        });
        poId = po?.purchaseorder_id ? String(po.purchaseorder_id) : null;
        resolvedVia = 'zoho';
      }

      if (!poId && mode === 'order') {
        // Explicit order mode, PO# fully missed (local + Zoho) — report not-found
        // WITHOUT spawning a phantom carton (an order# typo must not create a box).
        return NextResponse.json({
          success: true,
          matched: false,
          po_matched: false,
          not_found: true,
          po_ids: [],
          error: `No PO found for order number "${poLookupValue}"`,
        });
      }

      // PO# resolved → open the matched carton. When `auto` missed the PO# (poId
      // null), this block is skipped and execution falls out to the carrier-
      // tracking path below — the same value is tried as a tracking before any
      // unfound carton is created.
      if (poId) {

      const { receivingId } = await upsertMatchedReceiving(poId, carrier, staffId, ctx.organizationId);
      let integrationError: 'zoho_not_connected' | null = null;
      const linked = await linkLocalPoLinesToReceiving(poId, receivingId, ctx.organizationId);
      // Only hit Zoho for line items when there was nothing local to adopt.
      if (linked === 0) {
        await importZohoPurchaseOrderToReceiving(ctx.organizationId, poId, {
          receivingId,
          workflowStatus: 'MATCHED',
        }).catch((err) => {
          if (isCredentialNotConnected(err)) {
            integrationError = 'zoho_not_connected';
            console.error(
              `[lookup-po.order] Zoho not connected — PO ${poId} matched but its line items could not import`,
              { receiving_id: receivingId, message: errMessage(err) },
            );
          } else {
            console.warn(`[lookup-po.order] import(${poId}) failed`, errMessage(err));
          }
        });
      }
      await recordScan(receivingId, trackingNumber, carrier, staffId, 'zoho_po');
      await applyIntakeClassification(receivingId, classification, ctx.organizationId);

      const [lines, receiving_package] = await Promise.all([
        fetchLines(receivingId, ctx.organizationId),
        fetchReceivingPackage(receivingId, ctx.organizationId),
      ]);
      const pendingOrderSkus = await computePendingOrderSkus(ctx.organizationId, lines);

      after(async () => {
        try {
          await invalidateCacheTags(['receiving-logs', 'receiving-lines', 'pending-unboxing']);
        } catch (err) {
          console.warn('[lookup-po.order] cache invalidation failed', errMessage(err));
        }
        try {
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'insert',
            rowId: String(receivingId),
            source: 'receiving.lookup-po.order',
          });
        } catch (err) {
          console.warn('[lookup-po.order] realtime publish failed', errMessage(err));
        }
        if (pendingOrderSkus.length > 0) {
          await markReceivingPriority(receivingId, ctx.organizationId);
          try {
            await publishPriorityUnbox({
              organizationId: ctx.organizationId,
              staffId,
              trackingNumber,
              receivingId,
              skus: pendingOrderSkus,
              source: 'receiving.lookup-po.order',
            });
          } catch (err) {
            console.warn('[lookup-po.order] priority-unbox publish failed', errMessage(err));
          }
        }
      });

      return NextResponse.json({
        success: true,
        receiving_id: receivingId,
        preexisting: linked > 0,
        deduped: false,
        matched: lines.length > 0,
        po_matched: true,
        resolved_via: resolvedVia,
        unbox_verdict: pendingOrderSkus.length > 0 ? 'expedited' : 'normal',
        po_ids: [poId],
        pending_order_skus: pendingOrderSkus,
        integration_error: integrationError,
        receiving_package,
        lines: lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          image_url: l.image_url,
          zoho_item_id: l.zoho_item_id,
          zoho_purchaseorder_id: l.zoho_purchaseorder_id,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        })),
      });
      } // end if (poId) — auto PO#-miss falls through to the tracking path below
    }

    // 1. Dedup short-circuit — scan already logged against a receiving row.
    //    Short-circuit ONLY when the receiving row has lines. If lines are
    //    empty (e.g. receiving_lines was truncated, or the row was created
    //    as 'unmatched' before Zoho synced the PO), fall through to the
    //    Zoho lookup so we can repopulate the PO linkage on this same row.
    const existingScan = await findScanByTracking(trackingNumber, staffId, carrier, ctx.organizationId);
    let preassignedReceivingId: number | null = null;
    let preassignedScanId: number | null = null;
    if (existingScan) {
      await applyIntakeClassification(existingScan.receiving_id, classification, ctx.organizationId);
      const [lines, receiving_package] = await Promise.all([
        fetchLines(existingScan.receiving_id, ctx.organizationId),
        fetchReceivingPackage(existingScan.receiving_id, ctx.organizationId),
      ]);
      if (lines.length > 0) {
        // Re-attribute this dock event to the current operator (dedup path
        // used to leave scanned_by stale or NULL via memoizeLookupHit).
        const recvSourceRes = await tenantQuery<{ source: string | null }>(
          ctx.organizationId,
          `SELECT source FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [existingScan.receiving_id, ctx.organizationId],
        );
        const recvSource = String(recvSourceRes.rows[0]?.source || 'unmatched');
        await recordReceivingScan(
          existingScan.receiving_id,
          trackingNumber,
          carrier,
          staffId,
          recvSource === 'zoho_po' ? 'zoho_po' : 'unmatched',
        );
        const poIdsSet = new Set<string>();
        for (const l of lines) {
          if (l.zoho_purchaseorder_id) poIdsSet.add(l.zoho_purchaseorder_id);
        }
        const pendingOrderSkus = await computePendingOrderSkus(ctx.organizationId, lines);
        if (pendingOrderSkus.length > 0) {
          await markReceivingPriority(existingScan.receiving_id, ctx.organizationId);
          after(async () => {
            try {
              await publishPriorityUnbox({
                organizationId: ctx.organizationId,
                staffId,
                trackingNumber,
                receivingId: existingScan.receiving_id,
                skus: pendingOrderSkus,
                source: 'receiving.lookup-po',
              });
            } catch (err) {
              console.warn('lookup-po: priority-unbox publish failed', errMessage(err));
            }
          });
        }
        return NextResponse.json({
          success: true,
          receiving_id: existingScan.receiving_id,
          scan_id: existingScan.scan_id,
          preexisting: true,
          deduped: true,
          matched: true,
          po_matched: true,
          unbox_verdict: pendingOrderSkus.length > 0 ? 'expedited' : 'normal',
          po_ids: Array.from(poIdsSet),
          pending_order_skus: pendingOrderSkus,
          receiving_package,
          lines: lines.map((l) => ({
            id: l.id,
            sku: l.sku,
            item_name: l.item_name,
            image_url: l.image_url,
            zoho_item_id: l.zoho_item_id,
            zoho_purchaseorder_id: l.zoho_purchaseorder_id,
            quantity_expected: l.quantity_expected,
            quantity_received: l.quantity_received,
          })),
        });
      }
      // Empty lines — carry the existing ids forward so the Zoho branch
      // promotes this same row instead of creating a duplicate.
      preassignedReceivingId = existingScan.receiving_id;
      preassignedScanId = existingScan.scan_id;
    }

    // 1b. TEST / demo shortcut — instant matched carton, no Zoho. Lets the
    //     door-scan → unbox flow be tested with a typed tracking like TEST123.
    if (isTestTracking(trackingNumber)) {
      const { receivingId, scanId, preexisting, poId } = await createOrGetTestReceiving(
        trackingNumber,
        carrier,
        staffId,
        ctx.organizationId,
      );
      await applyIntakeClassification(receivingId, classification, ctx.organizationId);
      const [lines, receiving_package] = await Promise.all([
        fetchLines(receivingId, ctx.organizationId),
        fetchReceivingPackage(receivingId, ctx.organizationId),
      ]);
      const pendingOrderSkus = await computePendingOrderSkus(ctx.organizationId, lines);
      after(async () => {
        try {
          await invalidateCacheTags(['receiving-logs', 'receiving-lines', 'pending-unboxing']);
        } catch (err) {
          console.warn('[lookup-po.test] cache invalidation failed', errMessage(err));
        }
        try {
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'insert',
            rowId: String(receivingId),
            source: 'receiving.lookup-po.test',
          });
        } catch (err) {
          console.warn('[lookup-po.test] realtime publish failed', errMessage(err));
        }
        if (pendingOrderSkus.length > 0) {
          await markReceivingPriority(receivingId, ctx.organizationId);
          try {
            await publishPriorityUnbox({
              organizationId: ctx.organizationId,
              staffId,
              trackingNumber,
              receivingId,
              skus: pendingOrderSkus,
              source: 'receiving.lookup-po.test',
            });
          } catch (err) {
            console.warn('[lookup-po.test] priority-unbox publish failed', errMessage(err));
          }
        }
      });
      return NextResponse.json({
        success: true,
        receiving_id: receivingId,
        scan_id: scanId,
        preexisting,
        deduped: false,
        matched: true,
        po_matched: true,
        unbox_verdict: pendingOrderSkus.length > 0 ? 'expedited' : 'normal',
        is_test: true,
        po_ids: [poId],
        pending_order_skus: pendingOrderSkus,
        receiving_package,
        lines: lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          image_url: l.image_url,
          zoho_item_id: l.zoho_item_id,
          zoho_purchaseorder_id: l.zoho_purchaseorder_id,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        })),
      });
    }

    // 2. Zoho lookup for PO ids. Single search key: last 8 digits of the
    //    tracking number — same key used at every local layer above, so a
    //    miss here means the PO genuinely isn't in Zoho yet (rather than a
    //    format mismatch). At most 2 Zoho calls per scan (receives, then
    //    orders), down from 8 in the old variant ladder.
    const zohoPoIds = new Set<string>();
    let zohoReachable = true;

    // 1c. LOCAL-FIRST tracking → PO. The incoming sync already mirrors this PO's
    //     header + lines locally (the reported "in the Incoming table but never
    //     scanned" case), so resolve the PO id from local data and seed it here.
    //     The matched path below then adopts the pre-materialized local lines and
    //     the live Zoho tracking search is skipped entirely — instant, no loader.
    const localPoId = await resolvePoIdLocallyByTracking(
      trackingNumber,
      preassignedReceivingId,
      ctx.organizationId,
    );
    if (localPoId) zohoPoIds.add(localPoId);

    const digits = trackingNumber.replace(/\D/g, '');
    const last8 = digits.length >= 8 ? digits.slice(-8) : '';

    // Only reach for Zoho when local resolution came up empty — and never in
    // localOnly mode (the client's instant first phase; the Zoho search happens
    // on its background follow-up call instead).
    if (last8 && zohoPoIds.size === 0 && !localOnly) {
      try {
        const receives = await searchPurchaseReceivesByTracking(last8).catch((err) => {
          // Reachability heuristic: HTTP 4xx with a JSON body = Zoho is up and
          // says "no match"; anything else (network, 5xx, timeout) = unreachable.
          // The distinction matters for alerting and for the exception_reason
          // we write below ('not_found' vs 'zoho_unreachable').
          if (!isZohoNoMatch(err)) {
            zohoReachable = false;
            console.error(
              '[lookup-po.zoho] searchPurchaseReceivesByTracking outage',
              { last8, status: zohoErrStatus(err), code: zohoErrCode(err), message: errMessage(err) },
            );
          } else {
            console.warn(
              '[lookup-po.zoho] searchPurchaseReceivesByTracking no-match',
              { last8, status: zohoErrStatus(err) },
            );
          }
          return [];
        });
        for (const r of receives) {
          const poId = String(r.purchaseorder_id || '');
          if (poId) zohoPoIds.add(poId);
        }
        if (zohoPoIds.size === 0 && zohoReachable) {
          const pos = await searchPurchaseOrdersByTracking(last8).catch((err) => {
            if (!isZohoNoMatch(err)) {
              zohoReachable = false;
              console.error(
                '[lookup-po.zoho] searchPurchaseOrdersByTracking outage',
                { last8, status: zohoErrStatus(err), code: zohoErrCode(err), message: errMessage(err) },
              );
            } else {
              console.warn(
                '[lookup-po.zoho] searchPurchaseOrdersByTracking no-match',
                { last8, status: zohoErrStatus(err) },
              );
            }
            return [];
          });
          for (const po of pos) {
            if (po.purchaseorder_id) zohoPoIds.add(po.purchaseorder_id);
          }
        }
      } catch (err) {
        zohoReachable = false;
        console.error(
          '[lookup-po.zoho] unexpected throw outside .catch',
          { last8, message: errMessage(err) },
        );
      }
    }

    // 3a. MATCHED path — one receiving row per PO.
    if (zohoPoIds.size > 0) {
      const poIds = Array.from(zohoPoIds).slice(0, 3);
      const primaryPoId = poIds[0];

      let primaryReceivingId: number;
      let preexisting: boolean;

      if (preassignedReceivingId) {
        // Promote the existing (unmatched) receiving row to 'zoho_po' in
        // place so we keep its shipment_id/tracking# link. If a separate
        // 'zoho_po' row already claims this PO (unique index conflict),
        // fall back to the normal upsert + re-parent the scan.
        try {
          const promoted = await tenantQuery<{ id: number }>(
            ctx.organizationId,
            `UPDATE receiving
                SET source = 'zoho_po',
                    zoho_purchaseorder_id = $1,
                    carrier = COALESCE(NULLIF(carrier, ''), $2),
                    updated_at = NOW()
              WHERE id = $3
                AND (source = 'unmatched' OR zoho_purchaseorder_id IS NULL)
                AND organization_id = $4
              RETURNING id`,
            [primaryPoId, carrier || null, preassignedReceivingId, ctx.organizationId],
          );
          if (promoted.rows[0]) {
            primaryReceivingId = Number(promoted.rows[0].id);
            preexisting = true;
          } else {
            ({ receivingId: primaryReceivingId, preexisting } =
              await upsertMatchedReceiving(primaryPoId, carrier, staffId, ctx.organizationId));
          }
        } catch (err) {
          console.warn('lookup-po: promote preassigned receiving failed — using upsert', err);
          ({ receivingId: primaryReceivingId, preexisting } =
            await upsertMatchedReceiving(primaryPoId, carrier, staffId, ctx.organizationId));
        }
      } else {
        ({ receivingId: primaryReceivingId, preexisting } =
          await upsertMatchedReceiving(primaryPoId, carrier, staffId, ctx.organizationId));
      }

      const scanId = preassignedScanId ?? await recordScan(
        primaryReceivingId,
        trackingNumber,
        carrier,
        staffId,
        'zoho_po',
      );
      // If the scan was attached to a different receiving row (rare race
      // between promote and upsert fallback), re-parent it now. Failure here
      // leaves an orphan scan pointing at the stale receiving row — log it
      // so a cleanup job can find it. Don't fail the request: the primary
      // receiving row is correct, only the scan linkage is stale.
      if (preassignedScanId && preassignedReceivingId !== primaryReceivingId) {
        await tenantQuery(
          ctx.organizationId,
          `UPDATE receiving_scans SET receiving_id = $1, source = 'zoho_po'
            WHERE id = $2 AND organization_id = $3`,
          [primaryReceivingId, preassignedScanId, ctx.organizationId],
        ).catch((err) => {
          console.error('[lookup-po] scan re-parent failed — orphaned scan', {
            scan_id: preassignedScanId,
            from_receiving_id: preassignedReceivingId,
            to_receiving_id: primaryReceivingId,
            primary_po_id: primaryPoId,
            message: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Adopt the PO's pre-materialized local lines first — the incoming sync
      // already wrote every line into receiving_lines (receiving_id NULL), so a
      // PO "in the system" just needs its lines re-parented onto this carton.
      // Only fall back to a live Zoho import when there was nothing local to
      // adopt (a PO that hasn't been synced yet). This mirrors the order-mode
      // path and fixes the regression where a multi-line PO already in the
      // Incoming mirror came back with zero lines (the Zoho re-import didn't
      // re-attach them) → matched-but-empty → the client rendered it 'unfound'.
      // Track an integration-connectivity failure so a matched-but-empty carton
      // is reported as "Zoho not connected" rather than a silent "No PO found".
      let integrationError: 'zoho_not_connected' | null = null;
      const linkedPrimary = await linkLocalPoLinesToReceiving(primaryPoId, primaryReceivingId, ctx.organizationId);
      if (linkedPrimary === 0) {
        await importZohoPurchaseOrderToReceiving(ctx.organizationId, primaryPoId, {
          receivingId: primaryReceivingId,
          workflowStatus: 'MATCHED',
        }).catch((err) => {
          if (isCredentialNotConnected(err)) {
            integrationError = 'zoho_not_connected';
            console.error(
              `[lookup-po] Zoho not connected — PO ${primaryPoId} matched but its line items could not import`,
              { receiving_id: primaryReceivingId, message: errMessage(err) },
            );
          } else {
            console.warn(`lookup-po: import(${primaryPoId}) failed`, err);
          }
        });
      }

      // Rare multi-PO tracking: each secondary PO gets its own receiving
      // row to respect the partial unique (zoho_purchaseorder_id) index.
      // We collect the secondary receiving ids so the client can show a
      // "multiple POs matched" prompt and route the operator to triage.
      const secondaryPoIds: string[] = [];
      const secondaryReceivingIds: number[] = [];
      for (const poId of poIds.slice(1)) {
        try {
          const { receivingId: extraReceivingId } = await upsertMatchedReceiving(
            poId,
            carrier,
            staffId,
            ctx.organizationId,
          );
          await recordScan(extraReceivingId, trackingNumber, carrier, staffId, 'zoho_po');
          const linkedSecondary = await linkLocalPoLinesToReceiving(poId, extraReceivingId, ctx.organizationId);
          if (linkedSecondary === 0) {
            await importZohoPurchaseOrderToReceiving(ctx.organizationId, poId, {
              receivingId: extraReceivingId,
              workflowStatus: 'MATCHED',
            });
          }
          secondaryPoIds.push(poId);
          secondaryReceivingIds.push(extraReceivingId);
        } catch (err) {
          console.warn(`lookup-po: secondary PO import failed for ${poId}`, err);
        }
      }

      await applyIntakeClassification(primaryReceivingId, classification, ctx.organizationId);
      const [lines, receiving_package_matched] = await Promise.all([
        fetchLines(primaryReceivingId, ctx.organizationId),
        fetchReceivingPackage(primaryReceivingId, ctx.organizationId),
      ]);

      const uniqueByKey = new Map<string, { sku: string; zohoItemId: string | null }>();
      for (const line of lines) {
        const sku = (line.sku || '').trim();
        if (!sku) continue;
        const key = `${sku}::${line.zoho_item_id || ''}`;
        if (!uniqueByKey.has(key)) {
          uniqueByKey.set(key, { sku, zohoItemId: line.zoho_item_id });
        }
      }

      after(async () => {
        try {
          await parallelLimit(
            Array.from(uniqueByKey.values()),
            4,
            async ({ sku, zohoItemId }) => {
              await ensureSkuCatalogEntry(sku, {
                zoho_item_id: zohoItemId ?? undefined,
                zoho_purchaseorder_id: primaryPoId ?? undefined,
              }, ctx.organizationId);
            },
          );
        } catch (err) {
          // Warmup is best-effort: a future page load will re-fetch from
          // sku_catalog. WARN is appropriate.
          console.warn('[lookup-po.after] sku_catalog warmup failed', {
            receiving_id: primaryReceivingId,
            message: errMessage(err),
          });
        }
        try {
          await invalidateCacheTags([
            'receiving-logs',
            'receiving-lines',
            'pending-unboxing',
            'sku-catalog',
            'tracking-exceptions',
          ]);
        } catch (err) {
          // Cache invalidation failure → stale UI until TTL expires (60s).
          // Visible but recoverable; WARN.
          console.warn('[lookup-po.after] cache invalidation failed', {
            receiving_id: primaryReceivingId,
            tags: ['receiving-logs', 'receiving-lines', 'pending-unboxing', 'sku-catalog', 'tracking-exceptions'],
            message: errMessage(err),
          });
        }
        try {
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: preexisting ? 'update' : 'insert',
            rowId: String(primaryReceivingId),
            source: 'receiving.lookup-po',
          });
        } catch (err) {
          // Realtime failure → connected clients won't refresh until they
          // poll or reload. Higher severity than cache because polling can
          // be slow; ERROR so it surfaces in alerting.
          console.error('[lookup-po.after] realtime publish failed', {
            receiving_id: primaryReceivingId,
            action: preexisting ? 'update' : 'insert',
            message: errMessage(err),
          });
        }
        try {
          // If this tracking had previously landed as 'unmatched' and logged
          // a receiving exception, the Zoho hit now retroactively resolves it.
          await resolveReceivingExceptionsByReceivingId(primaryReceivingId);
        } catch (err) {
          console.warn('[lookup-po.after] resolveReceivingExceptionsByReceivingId failed', {
            receiving_id: primaryReceivingId,
            message: errMessage(err),
          });
        }
      });

      const pendingOrderSkus = await computePendingOrderSkus(ctx.organizationId, lines);
      if (pendingOrderSkus.length > 0) {
        await markReceivingPriority(primaryReceivingId, ctx.organizationId);
        after(async () => {
          try {
            await publishPriorityUnbox({
              organizationId: ctx.organizationId,
              staffId,
              trackingNumber,
              receivingId: primaryReceivingId,
              skus: pendingOrderSkus,
              source: 'receiving.lookup-po',
            });
          } catch (err) {
            console.warn('lookup-po: priority-unbox publish failed', errMessage(err));
          }
        });
      }

      return NextResponse.json({
        success: true,
        receiving_id: primaryReceivingId,
        scan_id: scanId,
        preexisting,
        deduped: false,
        matched: true,
        po_matched: true,
        unbox_verdict: pendingOrderSkus.length > 0 ? 'expedited' : 'normal',
        po_ids: poIds,
        pending_order_skus: pendingOrderSkus,
        // Secondary POs each get their own receiving row but lines from them
        // aren't part of the primary carton view. Surface them so the client
        // can prompt the operator to triage rather than silently miss them.
        secondary_po_ids: secondaryPoIds,
        secondary_receiving_ids: secondaryReceivingIds,
        multi_po_warning: secondaryPoIds.length > 0,
        zoho_reachable: true,
        // Non-null when the PO header matched but its lines could not import
        // because Zoho isn't connected — lets the client show a connect prompt
        // instead of a misleading "No PO found".
        integration_error: integrationError,
        receiving_package: receiving_package_matched,
        lines: lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          image_url: l.image_url,
          zoho_item_id: l.zoho_item_id,
          zoho_purchaseorder_id: l.zoho_purchaseorder_id,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        })),
      });
    }

    // 3b. UNMATCHED path — Zoho had no hit (or was unreachable). Log it, and
    //     upsert a row into tracking_exceptions so the triage/reconciliation
    //     worker can retry this tracking once Zoho catches up.
    //
    //     REUSE the preassigned receiving row when one already exists (a re-scan,
    //     or the instant-unfound localOnly carton this same client is following
    //     up on) — createUnmatchedReceiving has no dedup, so calling it again
    //     would create a DUPLICATE unfound carton for the same tracking. Only
    //     create a fresh row on a genuine first miss.
    let unmatchedReceivingId: number;
    let unmatchedShipmentId: number | null;
    if (preassignedReceivingId != null) {
      unmatchedReceivingId = preassignedReceivingId;
      const shipRow = await tenantQuery<{ shipment_id: number | null }>(
        ctx.organizationId,
        `SELECT shipment_id FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [preassignedReceivingId, ctx.organizationId],
      );
      unmatchedShipmentId = shipRow.rows[0]?.shipment_id ?? null;
    } else {
      ({ receivingId: unmatchedReceivingId, shipmentId: unmatchedShipmentId } =
        await createUnmatchedReceiving(trackingNumber, carrier, staffId, ctx.organizationId));
    }
    const unmatchedScanId = preassignedScanId ?? await recordScan(
      unmatchedReceivingId,
      trackingNumber,
      carrier,
      staffId,
      'unmatched',
    );

    const exceptionReason = zohoReachable ? 'not_found' : 'zoho_unreachable';
    const exception = await upsertOpenTrackingException({
      trackingNumber,
      domain: 'receiving',
      sourceStation: 'receiving',
      staffId,
      reason: exceptionReason,
      notes: zohoReachable
        ? 'Receiving scan: tracking not found in Zoho purchase orders or receives'
        : 'Receiving scan: Zoho API unreachable during lookup',
      shipmentId: unmatchedShipmentId,
      receivingId: unmatchedReceivingId,
      lastError: zohoReachable ? null : 'zoho_unreachable',
      domainMetadata: {
        carrier: carrier || null,
        candidates_tried: last8 ? [last8] : [],
        zoho_reachable: zohoReachable,
        scan_id: unmatchedScanId,
      },
    }, undefined, ctx.organizationId).catch((err) => {
      console.warn('lookup-po: upsertOpenTrackingException (receiving) failed', err);
      return null;
    });

    after(async () => {
      try {
        await invalidateCacheTags([
          'receiving-logs',
          'receiving-lines',
          'pending-unboxing',
          'tracking-exceptions',
        ]);
      } catch (err) {
        console.warn('[lookup-po.after.unmatched] cache invalidation failed', {
          receiving_id: unmatchedReceivingId,
          message: errMessage(err),
        });
      }
      try {
        await publishReceivingLogChanged({
          organizationId: ctx.organizationId,
          action: 'insert',
          rowId: String(unmatchedReceivingId),
          source: 'receiving.lookup-po',
        });
      } catch (err) {
        console.error('[lookup-po.after.unmatched] realtime publish failed', {
          receiving_id: unmatchedReceivingId,
          message: errMessage(err),
        });
      }
    });

    await applyIntakeClassification(unmatchedReceivingId, classification, ctx.organizationId);
    const receiving_package_unmatched = await fetchReceivingPackage(unmatchedReceivingId, ctx.organizationId);

    return NextResponse.json({
      success: true,
      receiving_id: unmatchedReceivingId,
      scan_id: unmatchedScanId,
      exception_id: exception?.id ?? null,
      exception_reason: exception ? exceptionReason : null,
      preexisting: false,
      deduped: false,
      matched: false,
      po_matched: false,
      unbox_verdict: 'unfound',
      po_ids: [],
      zoho_reachable: zohoReachable,
      // Provisional unfound: localOnly skipped the live Zoho search, so the
      // client should fire a background (Zoho) follow-up that can still promote
      // this carton to matched in place. A non-localOnly unfound is final.
      zoho_pending: localOnly,
      receiving_package: receiving_package_unmatched,
      lines: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to look up PO';
    console.error('receiving/lookup-po POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, {
  permission: 'receiving.scan_po',
  audit: {
    source: 'receiving.lookup-po',
    action: AUDIT_ACTION.PO_LOOKUP,
    entityType: AUDIT_ENTITY.RECEIVING,
    entityId: ({ response }) => {
      const r = response as { receiving_id?: number | string } | null;
      return r?.receiving_id ?? null;
    },
    extra: ({ response, body }) => {
      const r = response as { po_matched?: boolean; deduped?: boolean } | null;
      const b = body as { trackingNumber?: string } | null;
      return {
        tracking_number: b?.trackingNumber ?? null,
        po_matched: r?.po_matched ?? null,
        deduped: r?.deduped ?? null,
      };
    },
  },
});
