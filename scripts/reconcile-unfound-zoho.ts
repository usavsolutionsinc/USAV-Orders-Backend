/**
 * Re-match historical UNFOUND cartons to Zoho POs by reference# / tracking, the
 * same way the UI/cron already does it (reuses searchPurchaseOrdersByTracking +
 * reconcileUnmatchedReceiving — no hand-rolled Zoho logic). Optionally receives
 * the matched PO in Zoho.
 *
 * WHY the backlog exists: the hourly reconcile cron (sweepUnmatchedReceivings)
 * caps at maxAgeDays=7, so unmatched cartons older than a week were never
 * retried. ~862 of the current ~900 are older than 7 days.
 *
 * Three escalating modes (default is read-only):
 *   --scan     (default) READ-ONLY. For each unfound carton, run the same Zoho
 *              tracking search reconcile uses and report match quality. No writes.
 *   --match    Promote matched cartons in place + import PO lines
 *              (reconcileUnmatchedReceiving). Zoho READS + local DB writes.
 *              Does NOT receive in Zoho.
 *   --receive  Implies --match, then records the Zoho purchase receive
 *              (createPurchaseReceive) for newly-matched POs. *** Zoho WRITES to
 *              the system of record. ***
 *
 * Flags:
 *   --limit N           process at most N cartons (default: all)
 *   --max-age-days D     only cartons received within D days (default: 365)
 *   --delay-ms M         pause between cartons to respect Zoho rate limits (default 150)
 *
 * Usage:
 *   npx tsx scripts/reconcile-unfound-zoho.ts --scan --limit 25
 *   npx tsx scripts/reconcile-unfound-zoho.ts --match
 *   npx tsx scripts/reconcile-unfound-zoho.ts --receive
 */

import pool from '@/lib/db';
import {
  searchPurchaseReceivesByTracking,
  searchPurchaseOrdersByTracking,
  getPurchaseOrderById,
  createPurchaseReceive,
  assertPurchaseOrderReceivable,
  sumWarehouseReceivedByPoLineItem,
  catalogItemIdFromZohoPoLineItem,
  searchItemBySku,
} from '@/lib/zoho';
import { reconcileUnmatchedReceiving } from '@/lib/receiving/reconcile-unmatched';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const valOf = (f: string, dflt: number): number => {
  const i = argv.indexOf(f);
  if (i === -1 || i + 1 >= argv.length) return dflt;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : dflt;
};

const MODE: 'scan' | 'match' | 'receive' = has('--receive')
  ? 'receive'
  : has('--match')
    ? 'match'
    : 'scan';
const LIMIT = valOf('--limit', 0); // 0 = all
const MAX_AGE_DAYS = valOf('--max-age-days', 365);
const DELAY_MS = valOf('--delay-ms', 150);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last8 = (t: string | null) => {
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
};

async function main() {
  console.log(
    `\nMode: ${MODE.toUpperCase()}  |  max-age-days=${MAX_AGE_DAYS}  limit=${LIMIT || 'all'}  delay=${DELAY_MS}ms`,
  );
  if (MODE === 'receive') {
    console.log('*** --receive WRITES purchase receives to Zoho (system of record). ***');
  }

  const rows = (
    await pool.query<{ id: number; receiving_tracking_number: string | null }>(
      `SELECT r.id, r.receiving_tracking_number
         FROM receiving r
        WHERE r.source = 'unmatched'
          AND COALESCE(r.zoho_purchaseorder_id, '') = ''
          AND r.receiving_tracking_number IS NOT NULL
          AND COALESCE(r.received_at, r.created_at) > NOW() - ($1 || ' days')::interval
          AND NOT EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id)
        ORDER BY COALESCE(r.received_at, r.created_at) DESC`,
      [String(MAX_AGE_DAYS)],
    )
  ).rows;

  const work = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
  console.log(`Candidates in window: ${rows.length}; processing: ${work.length}\n`);

  const stat = { noTracking: 0, noMatch: 0, exact: 0, fuzzyOnly: 0, multi: 0, promoted: 0, received: 0, alreadyReceived: 0, errors: 0 };
  const ambiguous: Array<{ id: number; tracking: string | null; poCount: number }> = [];

  for (const r of work) {
    const l8 = last8(r.receiving_tracking_number);
    if (!l8) { stat.noTracking++; continue; }
    try {
      // Same lookup chain reconcile/lookup-po use.
      let pos = await searchPurchaseReceivesByTracking(l8)
        .then((rs) => rs.map((x) => String(x.purchaseorder_id || '')).filter(Boolean))
        .catch(() => [] as string[]);
      let foundVia = 'receive';
      if (pos.length === 0) {
        const byTrack = await searchPurchaseOrdersByTracking(l8).catch(() => []);
        pos = byTrack.map((p) => String(p.purchaseorder_id || '')).filter(Boolean);
        foundVia = 'order';
        // Exact-vs-fuzzy: does any matched PO's reference_number actually carry the tracking?
        const exact = byTrack.some((p) =>
          String(p.reference_number || '').replace(/\D/g, '').includes(l8),
        );
        if (pos.length === 1 && exact) stat.exact++;
        else if (pos.length === 1) stat.fuzzyOnly++;
      } else if (pos.length === 1) {
        stat.exact++; // a prior purchase-receive already carries this tracking — strong signal
      }

      const uniq = Array.from(new Set(pos));
      if (uniq.length === 0) { stat.noMatch++; }
      else if (uniq.length > 1) { stat.multi++; ambiguous.push({ id: r.id, tracking: r.receiving_tracking_number, poCount: uniq.length }); }

      if (MODE === 'scan') { await sleep(DELAY_MS); continue; }

      // --match / --receive: promote + import lines via the existing UI/cron path.
      if (uniq.length !== 1) { await sleep(DELAY_MS); continue; } // skip ambiguous/none for writes
      const res = await reconcileUnmatchedReceiving(r.id);
      if (!res.promoted) { await sleep(DELAY_MS); continue; }
      stat.promoted++;
      console.log(`  promoted rcv ${r.id} → PO ${res.zohoPurchaseorderId} (${res.linesImported ?? 0} lines)`);

      if (MODE === 'receive' && res.zohoPurchaseorderId) {
        const recvd = await receiveMatchedPo(res.zohoPurchaseorderId);
        if (recvd === 'received') { stat.received++; console.log(`    received PO ${res.zohoPurchaseorderId} in Zoho`); }
        else if (recvd === 'already') { stat.alreadyReceived++; console.log(`    PO ${res.zohoPurchaseorderId} already received in Zoho (skipped)`); }
      }
    } catch (err) {
      stat.errors++;
      console.warn(`  rcv ${r.id} error:`, err instanceof Error ? err.message : err);
    }
    await sleep(DELAY_MS);
  }

  console.log('\n── Summary ──');
  console.table(stat);
  if (ambiguous.length) {
    console.log(`\nAmbiguous (multi-PO) — NOT auto-written:`);
    for (const a of ambiguous.slice(0, 50)) console.log(`  rcv ${a.id}  tracking=${a.tracking}  POs=${a.poCount}`);
  }
}

const ALREADY_RECEIVED_RE = /already\s+created\s+a\s+receive\s+for\s+all\s+the\s+items/i;

/**
 * Receive the still-pending quantity of a freshly-matched PO, exactly the way
 * mark-received-po's after() does — pending = ordered − already-warehouse-received
 * (so a PO partially received in Zoho is never over-received), item_id resolved
 * from the PO line (SKU fallback). Returns 'received' | 'already' | 'nothing'.
 */
async function receiveMatchedPo(poId: string): Promise<'received' | 'already' | 'nothing'> {
  const detail = await getPurchaseOrderById(poId);
  assertPurchaseOrderReceivable(detail);
  const po = detail.purchaseorder;
  const lines = Array.isArray(po?.line_items) ? po!.line_items! : [];
  const receivedTotals = await sumWarehouseReceivedByPoLineItem(poId);

  const lineItems: { line_item_id: string; quantity_received: number; item_id: string }[] = [];
  for (const raw of lines) {
    const li = raw as unknown as Record<string, unknown>;
    const id = String(li.line_item_id ?? li.id ?? '').trim();
    if (!id) continue;
    const ordered = Number(li.quantity ?? 0);
    if (!Number.isFinite(ordered) || ordered <= 0) continue;
    const pending = Math.max(0, Math.floor(ordered - (receivedTotals.get(id) ?? 0) + 1e-9));
    if (pending <= 0) continue;
    let itemId = catalogItemIdFromZohoPoLineItem(raw) || '';
    if (!itemId) {
      const sku = String(li.sku ?? '').trim();
      if (sku) {
        try { itemId = String((await searchItemBySku(sku))?.item_id || '').trim(); } catch { itemId = ''; }
      }
    }
    if (!itemId) continue; // can't receive a line with no catalog item_id; skip safely
    lineItems.push({ line_item_id: id, quantity_received: pending, item_id: itemId });
  }

  if (lineItems.length === 0) return 'already'; // nothing pending = PO already fully received
  try {
    await createPurchaseReceive({ purchaseOrderId: poId, lineItems, bills: po?.bills });
    return 'received';
  } catch (err) {
    if (ALREADY_RECEIVED_RE.test(err instanceof Error ? err.message : String(err))) return 'already';
    throw err;
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('reconcile-unfound-zoho failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
