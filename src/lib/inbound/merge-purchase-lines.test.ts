import test from 'node:test';
import assert from 'node:assert/strict';
import { matchZohoPo, mergeEbayLinesIntoZohoPo, type MergeDeps, type EbayCandidate } from './merge-purchase-lines';
import type { TxClient } from './purchase-links';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

// ── pure matcher ────────────────────────────────────────────────────────────
const cand = (over: Partial<EbayCandidate> = {}): EbayCandidate => ({
  receivingLineId: 1, sourceOrderId: '12-34567-89012', sku: 'SKU', tracking: null, ...over,
});

test('matchZohoPo matches on tracking last-8 (strongest)', () => {
  assert.equal(matchZohoPo(cand({ tracking: '1Z999AA10123456784' }), { zohoPurchaseOrderId: 'Z', tracking: '1Z999AA10123456784' }), 'tracking');
  // different representations sharing the last-8 still match
  assert.equal(matchZohoPo(cand({ tracking: '9400111899223456784' }), { zohoPurchaseOrderId: 'Z', tracking: 'prefix-23456784' }), 'tracking');
});

test('matchZohoPo matches the eBay order# in PO#/reference (exact) and notes (substring)', () => {
  assert.equal(matchZohoPo(cand(), { zohoPurchaseOrderId: 'Z', referenceNumber: '12-34567-89012' }), 'order_number');
  assert.equal(matchZohoPo(cand(), { zohoPurchaseOrderId: 'Z', notes: 'eBay order 12-34567-89012 paid' }), 'order_number');
});

test('matchZohoPo returns null on no signal and guards short order ids', () => {
  assert.equal(matchZohoPo(cand({ tracking: 'AAA' }), { zohoPurchaseOrderId: 'Z', tracking: 'BBB' }), null);
  assert.equal(matchZohoPo(cand({ sourceOrderId: '123' }), { zohoPurchaseOrderId: 'Z', notes: 'ref 123 here' }), null);
});

// ── orchestration ───────────────────────────────────────────────────────────
function fakes(opts: { candidates?: Array<Record<string, unknown>>; losers?: Array<Record<string, unknown>> } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const linkCalls: Array<Record<string, unknown>> = [];
  const equivCalls: Array<Record<string, unknown>> = [];
  const client: TxClient = {
    query: (async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/shipping_tracking_numbers stn/.test(sql)) {
        return { rows: [{ tracking_number: null, zoho_reference_number: null, zoho_notes: null, zoho_purchaseorder_number: 'PO-1' }], rowCount: 1 };
      }
      if (/JOIN inbound_purchase_order_links el/.test(sql)) return { rows: opts.candidates ?? [], rowCount: (opts.candidates ?? []).length };
      if (/SELECT rl\.id, rl\.zoho_purchaseorder_id/.test(sql)) return { rows: opts.losers ?? [], rowCount: (opts.losers ?? []).length };
      return { rows: [], rowCount: 1 };
    }) as TxClient['query'],
  };
  const deps: MergeDeps = {
    withTx: (async (_o: unknown, fn: (c: TxClient) => Promise<unknown>) => fn(client)) as MergeDeps['withTx'],
    upsertPurchaseLink: (async (_o: unknown, input: Record<string, unknown>) => { linkCalls.push(input); return { id: 1, receiving_line_id: input.receivingLineId, source_type: input.sourceType, source_order_id: input.sourceOrderId, source_line_item_id: input.sourceLineItemId ?? null, is_primary: input.isPrimary, platform_account_id: null }; }) as unknown as MergeDeps['upsertPurchaseLink'],
    recordEquivalence: (async (_o: unknown, input: Record<string, unknown>) => { equivCalls.push(input); return { id: 1, source_type_a: 'ebay', source_order_id_a: 'x', source_type_b: 'zoho', source_order_id_b: 'y', link_reason: input.linkReason }; }) as unknown as MergeDeps['recordEquivalence'],
  };
  return { deps, calls, linkCalls, equivCalls };
}

const SIGNALS = { zohoPurchaseOrderId: 'Z-1', poNumber: 'PO-1', tracking: '1Z999AA10123456784', referenceNumber: '1Z999AA10123456784', notes: '' };

test('no candidates → nothing merged', async () => {
  const { deps } = fakes({ candidates: [] });
  const r = await mergeEbayLinesIntoZohoPo(ORG, SIGNALS, deps);
  assert.equal(r.matched, 0);
  assert.equal(r.augmented.length, 0);
});

test('one match + one loser → full merge: link + equivalence + delete loser + merge log', async () => {
  const { deps, calls, linkCalls, equivCalls } = fakes({
    candidates: [{ receiving_line_id: 50, source_order_id: '12-34567-89012', sku: 'SKU', tracking: '1Z999AA10123456784' }],
    losers: [{ id: 77, zoho_purchaseorder_id: 'Z-1', zoho_purchaseorder_number: 'PO-1', zoho_line_item_id: 'L9', zoho_item_id: 'I9' }],
  });
  const r = await mergeEbayLinesIntoZohoPo(ORG, SIGNALS, deps);

  assert.equal(r.matched, 1);
  assert.deepEqual(r.augmented, [{ winnerLineId: 50, reason: 'tracking', loserLineId: 77 }]);
  // secondary zoho link on the eBay winner, carrying the loser's line item id
  assert.equal(linkCalls[0].receivingLineId, 50);
  assert.equal(linkCalls[0].sourceType, 'zoho');
  assert.equal(linkCalls[0].isPrimary, false);
  assert.equal(linkCalls[0].sourceLineItemId, 'L9');
  // equivalence ebay↔zoho, reason tracking
  assert.equal(equivCalls[0].sourceTypeA, 'ebay');
  assert.equal(equivCalls[0].sourceTypeB, 'zoho');
  assert.equal(equivCalls[0].linkReason, 'tracking');
  // loser deleted + merge log written
  assert.ok(calls.some((c) => /DELETE FROM receiving_lines/.test(c.sql) && c.params.includes(77)));
  assert.ok(calls.some((c) => /INSERT INTO inbound_purchase_merge_log/.test(c.sql)));
});

test('ambiguous (2 matches, 1 loser) → augment both, never delete', async () => {
  const { deps, calls, linkCalls } = fakes({
    candidates: [
      { receiving_line_id: 50, source_order_id: '12-34567-89012', sku: 'A', tracking: '1Z999AA10123456784' },
      { receiving_line_id: 51, source_order_id: '99-88888-77777', sku: 'B', tracking: '1Z999AA10123456784' },
    ],
    losers: [{ id: 77, zoho_purchaseorder_id: 'Z-1', zoho_purchaseorder_number: 'PO-1', zoho_line_item_id: 'L9', zoho_item_id: 'I9' }],
  });
  const r = await mergeEbayLinesIntoZohoPo(ORG, SIGNALS, deps);
  assert.equal(r.matched, 2);
  assert.ok(r.augmented.every((a) => a.loserLineId === null), 'ambiguous → no loser deletion');
  assert.equal(linkCalls.length, 2);
  assert.ok(!calls.some((c) => /DELETE FROM receiving_lines/.test(c.sql)), 'must not delete on ambiguity');
});

test('candidate present but no signal match → nothing merged', async () => {
  const { deps } = fakes({
    candidates: [{ receiving_line_id: 50, source_order_id: '00-00000-00000', sku: 'A', tracking: 'ZZZ' }],
    losers: [{ id: 77, zoho_purchaseorder_id: 'Z-1', zoho_line_item_id: 'L9' }],
  });
  const r = await mergeEbayLinesIntoZohoPo(ORG, SIGNALS, deps);
  assert.equal(r.matched, 0);
});
