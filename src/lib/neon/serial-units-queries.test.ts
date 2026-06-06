/**
 * Guards for the "reverse-link on inbound" primitive (relational-reuse plan
 * Phase 1) and the two write paths that consume it.
 *
 * 1. resolvePriorOutbound prefers the inventory-v2 allocation path, falls back
 *    to the legacy tech_serial_numbers shipment link, and returns null when a
 *    serial was never shipped — using an injected Queryable, no DB.
 * 2. The returns intake and the RMA disposition path both resolve the prior
 *    order and flip the open SHIPPED allocation → RETURNED.
 * 3. The migration relaxes the allocation state CHECK to admit RETURNED and
 *    treats RETURNED as a CLOSED state in the one-open-allocation index.
 */

import { test } from 'node:test';
import { ok, equal } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePriorOutbound, type Queryable } from './serial-units-queries';

const allocationRow = {
  order_pk: 4242,
  order_id: 'ORD-1001',
  product_title: 'Widget',
  sku: 'WID-1',
  condition: 'USED_A',
  quantity: 1,
  tracking_number: '1Z-TRACK',
  allocation_state: 'SHIPPED',
  allocated_at: '2026-06-01T00:00:00Z',
};

const tsnRow = { ...allocationRow, order_pk: 7777, order_id: 'ORD-LEGACY', serial_number: 'SN-LEGACY' };

/** Route a query to the right canned result by inspecting the SQL text. */
function fakeExecutor(opts: {
  allocation?: Record<string, unknown> | null;
  tsn?: Record<string, unknown> | null;
}): Queryable & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query<T>(text: string) {
      if (/from order_unit_allocations/i.test(text)) {
        calls.push('allocation');
        const row = opts.allocation;
        return { rows: (row ? [row] : []) as T[], rowCount: row ? 1 : 0 };
      }
      if (/from tech_serial_numbers/i.test(text)) {
        calls.push('tsn');
        const row = opts.tsn;
        return { rows: (row ? [row] : []) as T[], rowCount: row ? 1 : 0 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
}

const UNIT = { id: 4242, normalized_serial: 'SN-LEGACY' };

test('resolvePriorOutbound prefers the allocation path and short-circuits the TSN fallback', async () => {
  const exec = fakeExecutor({ allocation: allocationRow, tsn: tsnRow });
  const result = await resolvePriorOutbound(UNIT, { executor: exec });
  ok(result, 'expected a match');
  equal(result!.via, 'allocation');
  equal(result!.orderPk, 4242);
  equal(result!.trackingNumber, '1Z-TRACK');
  ok(!exec.calls.includes('tsn'), 'must not run the TSN fallback once the allocation path matches');
});

test('resolvePriorOutbound falls back to the legacy tech_serial_numbers link', async () => {
  const exec = fakeExecutor({ allocation: null, tsn: tsnRow });
  const result = await resolvePriorOutbound(UNIT, { executor: exec });
  ok(result, 'expected a fallback match');
  equal(result!.via, 'tsn');
  equal(result!.orderPk, 7777);
  ok(exec.calls.includes('allocation') && exec.calls.includes('tsn'), 'must try allocation then TSN');
});

test('resolvePriorOutbound returns null for a serial that never shipped', async () => {
  const exec = fakeExecutor({ allocation: null, tsn: null });
  const result = await resolvePriorOutbound(UNIT, { executor: exec });
  equal(result, null);
});

// ─── Source guards: the write paths consume the primitive ────────────────────

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

test('returns intake resolves the prior order and flips the allocation to RETURNED', () => {
  const src = read('../inventory/returns.ts');
  ok(/resolvePriorOutbound/.test(src), 'returns intake must call resolvePriorOutbound');
  ok(
    /UPDATE order_unit_allocations[\s\S]*state\s*=\s*'RETURNED'[\s\S]*state\s*=\s*'SHIPPED'/.test(src),
    'returns intake must flip the open SHIPPED allocation to RETURNED',
  );
  ok(/resolvedOrderId/.test(src), 'returns intake must use the resolved order id');
});

test('RMA disposition reverse-links inbound returns and flips the allocation', () => {
  const src = read('../rma/authorizations.ts');
  ok(/resolvePriorOutbound/.test(src), 'RMA disposition must call resolvePriorOutbound');
  ok(/INBOUND_FROM_CUSTOMER/.test(src), 'reverse-link must be gated on the inbound-customer direction');
  ok(
    /UPDATE order_unit_allocations[\s\S]*state\s*=\s*'RETURNED'[\s\S]*state\s*=\s*'SHIPPED'/.test(src),
    'RMA disposition must flip the open SHIPPED allocation to RETURNED',
  );
});

test('migration admits RETURNED and treats it as a closed allocation state', () => {
  const sql = read('../migrations/2026-06-06_close_return_loop.sql');
  ok(
    /CHECK \(state IN \([^)]*'RETURNED'[^)]*\)\)/.test(sql),
    'oua_state_chk must include RETURNED',
  );
  ok(
    /idx_oua_open_unit[\s\S]*WHERE state NOT IN \('RELEASED','RETURNED'\)/.test(sql),
    'the one-open-allocation index must exclude RETURNED so a refurbed unit can re-allocate',
  );
});
