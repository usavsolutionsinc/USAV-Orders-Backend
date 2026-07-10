import test from 'node:test';
import assert from 'node:assert/strict';
import type { QueryResultRow } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import type { CreateDemandAlertInput } from '@/lib/neon/sourcing-queries';
import {
  collectMissingPartsDemand,
  collectRepairPartsDemand,
  collectWarrantyPartsDemand,
  collectPendingSkuDemand,
  collectFbaReplenishmentDemand,
  runSourcingDemandCollectorsJob,
  PENDING_SKU_MIN_OCCURRENCES,
  type DemandCollectorDeps,
} from './sourcing-demand-collectors';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

interface Captured {
  queries: { orgId: OrgId; sql: string; params: unknown[] }[];
  opened: { input: CreateDemandAlertInput; orgId: OrgId }[];
}

/**
 * Call-capturing fakes. `rowsBySql` routes canned rows by a substring of the
 * SQL (table name); `createdIds` marks which alert opens report created=true
 * (default: all created).
 */
function fakes(
  rowsBySql: Record<string, QueryResultRow[]> = {},
  opts: { createEvery?: boolean; failTables?: string[] } = {},
) {
  const cap: Captured = { queries: [], opened: [] };
  const deps: DemandCollectorDeps = {
    queryRows: async <T extends QueryResultRow>(orgId: OrgId, sql: string, params: unknown[]) => {
      cap.queries.push({ orgId, sql, params });
      for (const table of opts.failTables ?? []) {
        if (sql.includes(table)) throw new Error(`boom: ${table}`);
      }
      for (const [needle, rows] of Object.entries(rowsBySql)) {
        if (sql.includes(needle)) return rows as T[];
      }
      return [] as T[];
    },
    openDemandAlert: async (input, orgId) => {
      cap.opened.push({ input, orgId });
      return { created: opts.createEvery ?? true };
    },
    listOrgIds: async () => [ORG],
  };
  return { deps, cap };
}

// ─── Individual collectors: field mapping + org threading ────────────────────

test('missing-parts collector maps pickup items to missing_part demand', async () => {
  const { deps, cap } = fakes({
    local_pickup_order_items: [
      { ref_id: 11, sku_id: 5, sku: 'ABC-1', product_title: 'Bose Soundbar', missing_parts_note: 'no remote', quantity: 2 },
      { ref_id: 12, sku_id: null, sku: 'ZZZ-9', product_title: null, missing_parts_note: null, quantity: 0 },
    ],
  });
  const rows = await collectMissingPartsDemand(ORG, 50, deps);

  assert.equal(cap.queries.length, 1);
  assert.equal(cap.queries[0].orgId, ORG);           // org threaded, never defaulted
  assert.deepEqual(cap.queries[0].params, [ORG, 50]); // limit threaded (size guard)

  assert.equal(rows.length, 2);
  assert.equal(rows[0].alertType, 'missing_part');
  assert.equal(rows[0].demandSource, 'missing_part');
  assert.equal(rows[0].demandRefType, 'order');
  assert.equal(rows[0].demandRefId, 11);
  assert.equal(rows[0].skuId, 5);
  assert.equal(rows[0].targetQty, 2);
  assert.equal(rows[0].searchQuery, null);           // SKU-backed → no free-text target
  assert.match(rows[0].reason, /no remote/);

  assert.equal(rows[1].skuId, null);
  assert.equal(rows[1].searchQuery, 'ZZZ-9');        // falls back to the raw sku
  assert.equal(rows[1].targetQty, 1);                // qty 0 clamps to 1
});

test('repair + warranty collectors map part needs with back-links', async () => {
  const { deps } = fakes({
    repair_service: [{ ref_id: 7, sku_id: null, product_title: 'Wave Radio', issue: 'blown amp' }],
    warranty_claims: [{ ref_id: 31, sku_id: 9, product_title: 'QC35', sku: 'QC35-BLK', claim_number: 'WC-0031' }],
  });

  const repair = await collectRepairPartsDemand(ORG, 10, deps);
  assert.equal(repair.length, 1);
  assert.equal(repair[0].alertType, 'repair_part');
  assert.equal(repair[0].demandSource, 'repair');
  assert.equal(repair[0].demandRefType, 'repair');
  assert.equal(repair[0].demandRefId, 7);
  assert.equal(repair[0].searchQuery, 'Wave Radio'); // SKU-less → titled free-text target
  assert.match(repair[0].reason, /blown amp/);

  const warranty = await collectWarrantyPartsDemand(ORG, 10, deps);
  assert.equal(warranty.length, 1);
  assert.equal(warranty[0].alertType, 'warranty_part');
  assert.equal(warranty[0].demandSource, 'warranty');
  assert.equal(warranty[0].demandRefType, 'warranty_claim');
  assert.equal(warranty[0].demandRefId, 31);
  assert.equal(warranty[0].skuId, 9);
  assert.equal(warranty[0].searchQuery, null);
  assert.match(warranty[0].reason, /WC-0031/);
});

test('pending-SKU collector emits free-text demand keyed by the queue row', async () => {
  const { deps, cap } = fakes({
    pending_skus: [{ ref_id: 3, raw_sku: 'SONY-XM4-CUP', suggested_title: 'Sony WH-1000XM4 earcup', occurrences: 4 }],
  });
  const rows = await collectPendingSkuDemand(ORG, 25, deps);

  // Occurrence threshold + limit threaded into the read.
  assert.deepEqual(cap.queries[0].params, [PENDING_SKU_MIN_OCCURRENCES, 25]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].skuId, null);
  assert.equal(rows[0].alertType, 'demand_no_stock'); // applied CHECK has no 'pending_sku' yet
  assert.equal(rows[0].demandSource, 'pending_sku');
  assert.equal(rows[0].demandRefType, 'pending_sku');
  assert.equal(rows[0].demandRefId, 3);
  assert.equal(rows[0].searchQuery, 'Sony WH-1000XM4 earcup');
  assert.equal(rows[0].severity, 'info');
});

test('replenishment collector emits only SKU-resolved fba_replenish demand', async () => {
  const { deps } = fakes({
    replenishment_requests: [{ sku_id: 42, item_name: 'Bose 700 pad', need_qty: 6 }],
  });
  const rows = await collectFbaReplenishmentDemand(ORG, 10, deps);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].alertType, 'fba_replenish');
  assert.equal(rows[0].demandSource, 'fba');
  assert.equal(rows[0].skuId, 42);                   // idempotency key (UUID refs unusable)
  assert.equal(rows[0].demandRefId, null);
  assert.equal(rows[0].targetQty, 6);
});

// ─── Runner: one writer, cap, dropped counts, isolation, idempotency ─────────

test('runner writes every collected row through the single demand writer', async () => {
  const { deps, cap } = fakes({
    local_pickup_order_items: [
      { ref_id: 1, sku_id: 5, sku: 'A', product_title: 'T', missing_parts_note: null, quantity: 1 },
    ],
    replenishment_requests: [{ sku_id: 42, item_name: 'Pad', need_qty: 2 }],
  });
  const out = await runSourcingDemandCollectorsJob({}, deps);

  assert.equal(cap.opened.length, 2);
  assert.ok(cap.opened.every((o) => o.orgId === ORG)); // org threaded into the writer
  assert.equal(cap.opened[0].input.alertType, 'missing_part');
  assert.equal(cap.opened[0].input.demandRefId, 1);
  assert.equal(cap.opened[1].input.alertType, 'fba_replenish');

  assert.equal(out.opened.missing_part, 1);
  assert.equal(out.opened.fba_replenish, 1);
  assert.equal(out.collected, 2);
  assert.equal(out.dropped_over_cap, 0);
  assert.equal(out.existing, 0);
  assert.equal(out.orgs_swept, 1);
  assert.equal(out.orgs_failed, 0);
  assert.deepEqual(out.collector_errors, []);
});

test('runner caps rows per org and counts the dropped remainder (no silent truncation)', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    ref_id: i + 1, sku_id: null, sku: `S-${i}`, product_title: `P ${i}`, missing_parts_note: null, quantity: 1,
  }));
  const { deps, cap } = fakes({ local_pickup_order_items: many });
  const out = await runSourcingDemandCollectorsJob({ capPerOrg: 3 }, deps);

  assert.equal(cap.opened.length, 3);          // only cap rows written
  assert.equal(out.collected, 5);
  assert.equal(out.dropped_over_cap, 2);       // remainder counted, not silent
  // Every collector read was also LIMITed to the cap.
  assert.ok(cap.queries.every((q) => q.params.includes(3)));
});

test('runner counts idempotent no-ops as existing, not opened', async () => {
  const { deps } = fakes(
    { warranty_claims: [{ ref_id: 1, sku_id: 2, product_title: 'X', sku: 'X-1', claim_number: 'WC-1' }] },
    { createEvery: false },
  );
  const out = await runSourcingDemandCollectorsJob({}, deps);
  assert.equal(out.opened.warranty_part, 0);
  assert.equal(out.existing, 1);
});

test('a failing collector is isolated — others still run and write', async () => {
  const { deps, cap } = fakes(
    {
      repair_service: [{ ref_id: 9, sku_id: 4, product_title: 'Amp', issue: null }],
    },
    { failTables: ['local_pickup_order_items'] },
  );
  const out = await runSourcingDemandCollectorsJob({}, deps);

  assert.deepEqual(out.collector_errors, [`${ORG}:missing_part`]);
  assert.equal(out.orgs_failed, 0);            // collector failure ≠ org failure
  assert.equal(out.opened.repair_part, 1);     // sibling collector still wrote
  assert.equal(cap.opened.length, 1);
});
