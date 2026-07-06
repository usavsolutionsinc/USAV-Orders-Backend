import test from 'node:test';
import assert from 'node:assert/strict';
import { linkInboundManually, type ManualLinkDeps } from './manual-link';
import type { TxClient } from './purchase-links';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

/**
 * Fake tx client + injected sub-writers. `links` seeds the existing-links read
 * for the line; `losers` seeds the duplicate zoho-only spine-row lookup.
 */
function fakes(opts: { line?: Record<string, unknown> | null; links?: Array<Record<string, unknown>>; losers?: Array<Record<string, unknown>> } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const linkCalls: Array<Record<string, unknown>> = [];
  const equivCalls: Array<Record<string, unknown>> = [];
  const line = opts.line === undefined ? { id: 50, zoho_purchaseorder_id: null } : opts.line;
  const client: TxClient = {
    query: (async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT id, zoho_purchaseorder_id\s+FROM receiving_lines WHERE id/.test(sql))
        return { rows: line ? [line] : [], rowCount: line ? 1 : 0 };
      if (/FROM inbound_purchase_order_links\s+WHERE organization_id = \$1 AND receiving_line_id/.test(sql))
        return { rows: opts.links ?? [], rowCount: (opts.links ?? []).length };
      if (/SELECT rl\.id\s+FROM receiving_lines rl/.test(sql))
        return { rows: opts.losers ?? [], rowCount: (opts.losers ?? []).length };
      return { rows: [], rowCount: 1 };
    }) as TxClient['query'],
  };
  const deps: ManualLinkDeps = {
    withTx: (async (_o: unknown, fn: (c: TxClient) => Promise<unknown>) => fn(client)) as ManualLinkDeps['withTx'],
    upsertPurchaseLink: (async (_o: unknown, input: Record<string, unknown>) => {
      linkCalls.push(input);
      return { id: 1, receiving_line_id: input.receivingLineId, source_type: input.sourceType, source_order_id: input.sourceOrderId, source_line_item_id: input.sourceLineItemId ?? null, is_primary: input.isPrimary, platform_account_id: null };
    }) as unknown as ManualLinkDeps['upsertPurchaseLink'],
    recordEquivalence: (async (_o: unknown, input: Record<string, unknown>) => {
      equivCalls.push(input);
      return { id: 1, source_type_a: 'ebay', source_order_id_a: 'x', source_type_b: 'zoho', source_order_id_b: 'y', link_reason: input.linkReason };
    }) as unknown as ManualLinkDeps['recordEquivalence'],
  };
  return { deps, calls, linkCalls, equivCalls };
}

const EBAY_PRIMARY = [{ source_type: 'ebay', source_order_id: '12-34567-89012', source_line_item_id: null, is_primary: true }];

test('eBay line → link Zoho PO: secondary zoho link + equivalence + spine cache + merge log', async () => {
  const { deps, calls, linkCalls, equivCalls } = fakes({ line: { id: 50, zoho_purchaseorder_id: null }, links: EBAY_PRIMARY, losers: [] });
  const r = await linkInboundManually(ORG, {
    receivingLineId: 50,
    target: { system: 'zoho', sourceOrderId: 'Z-1', sourceOrderNumber: 'PO-1' },
    linkedByStaffId: 7,
  }, deps);

  assert.equal(r.winnerLineId, 50);
  assert.equal(r.merged, false);
  assert.equal(r.linked, true);
  assert.equal(r.zohoPurchaseOrderId, 'Z-1');
  // secondary zoho link (eBay keeps the badge)
  assert.equal(linkCalls[0].sourceType, 'zoho');
  assert.equal(linkCalls[0].isPrimary, false);
  // equivalence ebay↔zoho, reason manual, staff threaded
  assert.equal(equivCalls[0].sourceTypeA, 'ebay');
  assert.equal(equivCalls[0].sourceTypeB, 'zoho');
  assert.equal(equivCalls[0].linkReason, 'manual');
  assert.equal(equivCalls[0].linkedByStaffId, 7);
  // zoho spine cache stamped + merge log written
  assert.ok(calls.some((c) => /UPDATE receiving_lines\s+SET zoho_purchaseorder_id/.test(c.sql) && c.params.includes('Z-1')));
  assert.ok(calls.some((c) => /INSERT INTO inbound_purchase_merge_log/.test(c.sql)));
});

test('augment_winner collapses exactly one duplicate zoho-only spine row', async () => {
  const { deps, calls } = fakes({ line: { id: 50, zoho_purchaseorder_id: null }, links: EBAY_PRIMARY, losers: [{ id: 77 }] });
  const r = await linkInboundManually(ORG, {
    receivingLineId: 50,
    target: { system: 'zoho', sourceOrderId: 'Z-1', sourceOrderNumber: 'PO-1' },
  }, deps);
  assert.equal(r.merged, true);
  assert.deepEqual(r.loserLineIds, [77]);
  assert.ok(calls.some((c) => /DELETE FROM receiving_lines/.test(c.sql) && c.params.includes(77)));
});

test('ambiguous (2 duplicate zoho-only rows) → augment, never delete', async () => {
  const { deps, calls } = fakes({ line: { id: 50, zoho_purchaseorder_id: null }, links: EBAY_PRIMARY, losers: [{ id: 77 }, { id: 78 }] });
  const r = await linkInboundManually(ORG, {
    receivingLineId: 50,
    target: { system: 'zoho', sourceOrderId: 'Z-1' },
  }, deps);
  assert.equal(r.merged, false);
  assert.equal(r.loserLineIds.length, 0);
  assert.ok(!calls.some((c) => /DELETE FROM receiving_lines/.test(c.sql)), 'must not delete on ambiguity');
});

test('augment_only never collapses even with one loser', async () => {
  const { deps, calls } = fakes({ line: { id: 50, zoho_purchaseorder_id: null }, links: EBAY_PRIMARY, losers: [{ id: 77 }] });
  const r = await linkInboundManually(ORG, {
    receivingLineId: 50,
    target: { system: 'zoho', sourceOrderId: 'Z-1' },
    mergeStrategy: 'augment_only',
  }, deps);
  assert.equal(r.merged, false);
  // augment_only skips the loser lookup entirely
  assert.ok(!calls.some((c) => /SELECT rl\.id\s+FROM receiving_lines rl/.test(c.sql)));
});

test('unmatched line (no primary) → target becomes primary, no equivalence', async () => {
  const { deps, linkCalls, equivCalls } = fakes({ line: { id: 50, zoho_purchaseorder_id: null }, links: [], losers: [] });
  const r = await linkInboundManually(ORG, {
    receivingLineId: 50,
    target: { system: 'zoho', sourceOrderId: 'Z-1', sourceOrderNumber: 'PO-1' },
  }, deps);
  assert.equal(linkCalls[0].isPrimary, true);
  assert.equal(equivCalls.length, 0, 'nothing to be equivalent to');
  assert.equal(r.primarySourceType, 'zoho');
});

test('idempotent re-link of the same identity → linked=false', async () => {
  const { deps } = fakes({
    line: { id: 50, zoho_purchaseorder_id: 'Z-1' },
    links: [...EBAY_PRIMARY, { source_type: 'zoho', source_order_id: 'Z-1', source_line_item_id: null, is_primary: false }],
    losers: [],
  });
  const r = await linkInboundManually(ORG, {
    receivingLineId: 50,
    target: { system: 'zoho', sourceOrderId: 'Z-1' },
  }, deps);
  assert.equal(r.linked, false);
});

test('missing line → throws', async () => {
  const { deps } = fakes({ line: null });
  await assert.rejects(
    () => linkInboundManually(ORG, { receivingLineId: 999, target: { system: 'zoho', sourceOrderId: 'Z-1' } }, deps),
    /receiving_line 999 not found/,
  );
});

test('unregistered target source → throws before any SQL', async () => {
  const { deps, calls } = fakes();
  await assert.rejects(
    () => linkInboundManually(ORG, { receivingLineId: 50, target: { system: 'shopify', sourceOrderId: 'X' } }, deps),
    /unregistered source_type/,
  );
  assert.equal(calls.length, 0);
});

test('blank target order id → throws', async () => {
  const { deps } = fakes();
  await assert.rejects(
    () => linkInboundManually(ORG, { receivingLineId: 50, target: { system: 'zoho', sourceOrderId: '  ' } }, deps),
    /sourceOrderId is required/,
  );
});
