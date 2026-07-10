/**
 * DB-free unit tests for the vendor-PO replenishment domain module
 * (src/lib/replenishment.ts) — house Deps/fakes pattern (see
 * src/lib/billing/studio-gate.test.ts).
 *
 * Coverage:
 *   - transitionReplenishmentStatus: legality matrix, no-op on same status,
 *     404-shape throw, org threading into every statement.
 *   - recalculateNeed: missing row, zero/negative/edge quantities, the
 *     auto-cancel branch, org threading.
 *   - createDraftPurchaseOrders: vendor grouping, zero/negative
 *     quantity_to_order filtering, Zoho failure, org threading through the
 *     injected deps, po_created transitions.
 *
 * All fns take an explicit client/orgId (orgId is REQUIRED as of the
 * org-require pass), so a fake `query`-capturing client exercises the SQL
 * paths with zero DB.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  transitionReplenishmentStatus,
  recalculateNeed,
  createDraftPurchaseOrders,
  REPLENISHMENT_ALLOWED_TRANSITIONS,
  type CreateDraftPurchaseOrdersDeps,
  type ReplenishmentRequestRow,
  type ReplenishmentStatus,
  type DbClient,
} from './replenishment';
import type { OrgId } from './tenancy/constants';

const ORG = '11111111-1111-1111-1111-111111111111' as OrgId;
const OTHER_ORG = '22222222-2222-2222-2222-222222222222' as OrgId;
const REQ_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * Fake pg client: records every query and answers via a substring-matched
 * responder table (first match wins).
 */
function fakeClient(
  responders: Array<{ match: string; rows?: Record<string, unknown>[]; rowCount?: number }> = [],
) {
  const calls: Captured[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = responders.find((r) => sql.includes(r.match));
      const rows = hit?.rows ?? [];
      return { rows, rowCount: hit?.rowCount ?? rows.length };
    },
  };
  return { calls, client: client as unknown as DbClient };
}

function requestRow(over: Partial<ReplenishmentRequestRow> = {}): ReplenishmentRequestRow {
  return {
    id: REQ_ID,
    item_id: '7',
    zoho_item_id: 'z-100',
    sku: 'SKU-1',
    item_name: 'Widget',
    quantity_needed: '5',
    zoho_quantity_available: '0',
    zoho_quantity_on_hand: '0',
    zoho_incoming_quantity: '0',
    quantity_to_order: '5',
    vendor_zoho_contact_id: 'vendor-1',
    vendor_name: 'Acme Supply',
    unit_cost: '10',
    status: 'pending_review',
    status_changed_at: '2026-07-09T00:00:00Z',
    zoho_po_id: null,
    zoho_po_number: null,
    notes: null,
    created_at: '2026-07-09T00:00:00Z',
    updated_at: '2026-07-09T00:00:00Z',
    ...over,
  };
}

/** A fresh (non-stale) item_stock_cache row so recalc never re-syncs Zoho. */
function stockCacheRow(over: Record<string, unknown> = {}) {
  return {
    zoho_item_id: 'z-100',
    quantity_available: 0,
    quantity_on_hand: 0,
    incoming_quantity: 0,
    last_synced_at: new Date().toISOString(),
    ...over,
  };
}

// ── transitionReplenishmentStatus ────────────────────────────────────────────

test('transition: legal move updates status and writes the status log with the org threaded', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT id, status FROM replenishment_requests', rows: [{ id: REQ_ID, status: 'detected' }] },
  ]);

  await transitionReplenishmentStatus(REQ_ID, 'pending_review', 'tester', 'note', client, ORG);

  assert.equal(calls.length, 3);
  // Row lookup is org-gated.
  assert.ok(calls[0].sql.includes('organization_id = $2'));
  assert.deepEqual(calls[0].params, [REQ_ID, ORG]);
  // UPDATE carries the org predicate.
  assert.ok(calls[1].sql.includes('UPDATE replenishment_requests'));
  assert.deepEqual(calls[1].params, [REQ_ID, 'pending_review', ORG]);
  // Status-log insert derives org from the parent and threads it as a guard.
  assert.ok(calls[2].sql.includes('INSERT INTO replenishment_status_log'));
  assert.deepEqual(calls[2].params, [REQ_ID, 'detected', 'pending_review', 'tester', 'note', ORG]);
});

test('transition: illegal move throws and writes nothing', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT id, status FROM replenishment_requests', rows: [{ id: REQ_ID, status: 'detected' }] },
  ]);

  await assert.rejects(
    () => transitionReplenishmentStatus(REQ_ID, 'fulfilled', 'tester', null, client, ORG),
    /Invalid replenishment transition: detected -> fulfilled/,
  );
  assert.equal(calls.length, 1, 'only the lookup ran; no UPDATE, no log');
});

test('transition: same status is a silent no-op (no UPDATE, no log)', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT id, status FROM replenishment_requests', rows: [{ id: REQ_ID, status: 'po_created' }] },
  ]);

  await transitionReplenishmentStatus(REQ_ID, 'po_created', 'tester', null, client, ORG);
  assert.equal(calls.length, 1);
});

test('transition: missing (or other-org) row throws not-found', async () => {
  const { client } = fakeClient([
    { match: 'SELECT id, status FROM replenishment_requests', rows: [] },
  ]);

  await assert.rejects(
    () => transitionReplenishmentStatus(REQ_ID, 'pending_review', 'tester', null, client, ORG),
    /Replenishment request not found/,
  );
});

test('transition legality matrix: terminal states allow nothing', () => {
  assert.deepEqual(REPLENISHMENT_ALLOWED_TRANSITIONS.fulfilled, []);
  assert.deepEqual(REPLENISHMENT_ALLOWED_TRANSITIONS.cancelled, []);
  // Every declared target is itself a known status.
  const known = Object.keys(REPLENISHMENT_ALLOWED_TRANSITIONS) as ReplenishmentStatus[];
  for (const targets of Object.values(REPLENISHMENT_ALLOWED_TRANSITIONS)) {
    for (const target of targets) assert.ok(known.includes(target), `unknown target ${target}`);
  }
});

// ── recalculateNeed ──────────────────────────────────────────────────────────

test('recalculateNeed: missing request row → no further work', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT * FROM replenishment_requests', rows: [] },
  ]);

  await recalculateNeed(REQ_ID, client, ORG);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [REQ_ID, ORG]);
});

test('recalculateNeed: shortfall > 0 → updates zoho quantities (org-gated), never cancels', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT * FROM replenishment_requests', rows: [requestRow({ status: 'detected', quantity_needed: '10' })] },
    { match: 'FROM item_stock_cache', rows: [stockCacheRow({ quantity_available: 2, incoming_quantity: 3 })] },
  ]);

  await recalculateNeed(REQ_ID, client, ORG);

  const update = calls.find((c) => c.sql.includes('SET zoho_quantity_available'));
  assert.ok(update, 'quantity snapshot UPDATE ran');
  assert.deepEqual(update!.params, [REQ_ID, 2, 0, 3, ORG]);
  assert.ok(!calls.some((c) => c.sql.includes('status_changed_at')), 'no cancel transition fired');
});

test('recalculateNeed: incoming stock covers demand on a detected request → auto-cancel transition', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT * FROM replenishment_requests', rows: [requestRow({ status: 'detected', quantity_needed: '5' })] },
    { match: 'FROM item_stock_cache', rows: [stockCacheRow({ quantity_available: 4, incoming_quantity: 1 })] },
    { match: 'SELECT id, status FROM replenishment_requests', rows: [{ id: REQ_ID, status: 'detected' }] },
  ]);

  await recalculateNeed(REQ_ID, client, ORG);

  const cancel = calls.find((c) => c.sql.includes('status_changed_at'));
  assert.ok(cancel, 'cancel transition ran');
  assert.deepEqual(cancel!.params, [REQ_ID, 'cancelled', ORG]);
  const log = calls.find((c) => c.sql.includes('replenishment_status_log'));
  assert.ok(log);
  assert.equal(log!.params[4], 'Incoming stock already covers demand');
});

test('recalculateNeed: zero and negative quantity_needed clamp to zero shortfall → cancel on pending_review', async () => {
  for (const qty of ['0', '-7']) {
    const { calls, client } = fakeClient([
      { match: 'SELECT * FROM replenishment_requests', rows: [requestRow({ status: 'pending_review', quantity_needed: qty })] },
      { match: 'FROM item_stock_cache', rows: [stockCacheRow()] },
      { match: 'SELECT id, status FROM replenishment_requests', rows: [{ id: REQ_ID, status: 'pending_review' }] },
    ]);

    await recalculateNeed(REQ_ID, client, ORG);
    assert.ok(
      calls.some((c) => c.sql.includes('status_changed_at') && c.params[1] === 'cancelled'),
      `qty=${qty} should auto-cancel`,
    );
  }
});

test('recalculateNeed: zero shortfall on a po_created request does NOT cancel (status gate)', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT * FROM replenishment_requests', rows: [requestRow({ status: 'po_created', quantity_needed: '0' })] },
    { match: 'FROM item_stock_cache', rows: [stockCacheRow()] },
  ]);

  await recalculateNeed(REQ_ID, client, ORG);
  assert.ok(!calls.some((c) => c.sql.includes('status_changed_at')));
});

test('recalculateNeed: non-numeric quantities degrade to 0, never NaN in params', async () => {
  const { calls, client } = fakeClient([
    { match: 'SELECT * FROM replenishment_requests', rows: [requestRow({ status: 'waiting_for_receipt', quantity_needed: 'garbage' })] },
    { match: 'FROM item_stock_cache', rows: [stockCacheRow({ quantity_available: 'also-garbage' })] },
  ]);

  await recalculateNeed(REQ_ID, client, ORG);
  const update = calls.find((c) => c.sql.includes('SET zoho_quantity_available'));
  assert.deepEqual(update!.params, [REQ_ID, 0, 0, 0, ORG]);
});

// ── createDraftPurchaseOrders ────────────────────────────────────────────────

function fakePoDeps(over: Partial<CreateDraftPurchaseOrdersDeps> & {
  rows?: ReplenishmentRequestRow[];
} = {}) {
  const seen = {
    loadOrg: null as OrgId | null,
    loadIds: null as string[] | null,
    zohoOrgs: [] as OrgId[],
    zohoPayloads: [] as Array<{ vendor_id: string; line_items: Array<{ item_id: string; quantity: number; rate: number }> }>,
    txOrgs: [] as OrgId[],
    txClient: fakeClient(),
    transitions: [] as Array<{ id: string; next: ReplenishmentStatus; orgId: OrgId; sameClient: boolean }>,
  };

  const deps: CreateDraftPurchaseOrdersDeps = {
    loadRequests: async (ids, orgId) => {
      seen.loadIds = ids;
      seen.loadOrg = orgId;
      return over.rows ?? [];
    },
    createZohoPurchaseOrder: async (orgId, payload) => {
      seen.zohoOrgs.push(orgId);
      seen.zohoPayloads.push(payload);
      return { purchaseorder: { purchaseorder_id: 'po-1', purchaseorder_number: 'PO-0001' } };
    },
    withTenantTransaction: async (orgId, fn) => {
      seen.txOrgs.push(orgId);
      return fn(seen.txClient.client as unknown as PoolClient);
    },
    transitionStatus: async (id, next, _changedBy, _note, client, orgId) => {
      seen.transitions.push({ id, next, orgId, sameClient: client === seen.txClient.client });
    },
    ...over,
  };
  return { deps, seen };
}

test('createDraftPurchaseOrders: threads orgId through load, Zoho create, tx, and transitions', async () => {
  const rows = [
    requestRow({ id: 'r1', quantity_to_order: '3' }),
    requestRow({ id: 'r2', zoho_item_id: 'z-200', quantity_to_order: '2' }),
  ];
  const { deps, seen } = fakePoDeps({ rows });

  const created = await createDraftPurchaseOrders(['r1', 'r2'], ORG, deps);

  assert.equal(seen.loadOrg, ORG);
  assert.deepEqual(seen.loadIds, ['r1', 'r2']);
  assert.deepEqual(seen.zohoOrgs, [ORG]);
  assert.deepEqual(seen.txOrgs, [ORG]);
  // Same vendor → ONE Zoho PO with both lines.
  assert.equal(seen.zohoPayloads.length, 1);
  assert.deepEqual(seen.zohoPayloads[0].line_items, [
    { item_id: 'z-100', quantity: 3, rate: 10 },
    { item_id: 'z-200', quantity: 2, rate: 10 },
  ]);
  // Both requests transitioned to po_created inside the SAME tx client, org threaded.
  assert.deepEqual(
    seen.transitions.map((t) => ({ id: t.id, next: t.next, orgId: t.orgId, sameClient: t.sameClient })),
    [
      { id: 'r1', next: 'po_created', orgId: ORG, sameClient: true },
      { id: 'r2', next: 'po_created', orgId: ORG, sameClient: true },
    ],
  );
  // The per-request PO stamp UPDATE is org-gated.
  const stamp = seen.txClient.calls.find((c) => c.sql.includes('SET zoho_po_id'));
  assert.ok(stamp);
  assert.deepEqual(stamp!.params, ['r1', 'po-1', 'PO-0001', ORG]);
  assert.deepEqual(created, [{ vendor: 'Acme Supply', zoho_po_id: 'po-1', zoho_po_number: 'PO-0001' }]);
});

test('createDraftPurchaseOrders: zero/negative/garbage quantity_to_order lines are dropped; all-dropped vendor makes no PO', async () => {
  const rows = [
    requestRow({ id: 'r1', quantity_to_order: '0' }),
    requestRow({ id: 'r2', quantity_to_order: '-4' }),
    requestRow({ id: 'r3', quantity_to_order: 'NaNish' }),
  ];
  const { deps, seen } = fakePoDeps({ rows });

  const created = await createDraftPurchaseOrders(['r1', 'r2', 'r3'], ORG, deps);

  assert.deepEqual(created, []);
  assert.equal(seen.zohoPayloads.length, 0, 'no Zoho call for an empty line set');
  assert.equal(seen.txOrgs.length, 0, 'no transaction opened');
});

test('createDraftPurchaseOrders: requests without a vendor are skipped', async () => {
  const rows = [
    requestRow({ id: 'r1', vendor_zoho_contact_id: null, quantity_to_order: '5' }),
    requestRow({ id: 'r2', vendor_zoho_contact_id: '   ', quantity_to_order: '5' }),
  ];
  const { deps, seen } = fakePoDeps({ rows });

  const created = await createDraftPurchaseOrders(['r1', 'r2'], ORG, deps);
  assert.deepEqual(created, []);
  assert.equal(seen.zohoPayloads.length, 0);
});

test('createDraftPurchaseOrders: mixed lines keep only positive quantities', async () => {
  const rows = [
    requestRow({ id: 'r1', quantity_to_order: '6' }),
    requestRow({ id: 'r2', zoho_item_id: 'z-300', quantity_to_order: '0' }),
  ];
  const { deps, seen } = fakePoDeps({ rows });

  await createDraftPurchaseOrders(['r1', 'r2'], ORG, deps);
  assert.deepEqual(seen.zohoPayloads[0].line_items, [{ item_id: 'z-100', quantity: 6, rate: 10 }]);
  // BUT the po_created transition still runs for every request in the vendor
  // bucket (current behavior — the zero-line rides along with its vendor PO).
  assert.deepEqual(seen.transitions.map((t) => t.id), ['r1', 'r2']);
});

test('createDraftPurchaseOrders: Zoho returning no PO id/number throws before any DB write', async () => {
  const rows = [requestRow({ id: 'r1', quantity_to_order: '2' })];
  const { deps, seen } = fakePoDeps({
    rows,
    createZohoPurchaseOrder: async () => ({ purchaseorder: {} }),
  });

  await assert.rejects(
    () => createDraftPurchaseOrders(['r1'], ORG, deps),
    /Zoho PO create returned no purchaseorder id\/number/,
  );
  assert.equal(seen.txOrgs.length, 0, 'no transaction opened after the Zoho failure');
});

test('createDraftPurchaseOrders: a different orgId is what reaches every collaborator (no ambient org)', async () => {
  const rows = [requestRow({ id: 'r1', quantity_to_order: '1' })];
  const { deps, seen } = fakePoDeps({ rows });

  await createDraftPurchaseOrders(['r1'], OTHER_ORG, deps);
  assert.equal(seen.loadOrg, OTHER_ORG);
  assert.deepEqual(seen.zohoOrgs, [OTHER_ORG]);
  assert.deepEqual(seen.txOrgs, [OTHER_ORG]);
  assert.equal(seen.transitions[0].orgId, OTHER_ORG);
});
