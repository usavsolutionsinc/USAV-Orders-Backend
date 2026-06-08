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

test('unit_uid migration adds the column + an org-scoped PARTIAL unique index', () => {
  const sql = read('../migrations/2026-06-06h_serial_units_unit_uid.sql');
  ok(/ADD COLUMN IF NOT EXISTS unit_uid/.test(sql), 'must add the unit_uid column');
  ok(
    /CREATE UNIQUE INDEX[\s\S]*ux_serial_units_org_unit_uid[\s\S]*\(organization_id, unit_uid\)[\s\S]*WHERE unit_uid IS NOT NULL/.test(sql),
    'unique index must be org-scoped AND partial (NULLs allowed for un-labeled rows)',
  );
});

test('upsertSerialUnit persists unit_uid on insert and COALESCEs it on update', () => {
  const src = read('./serial-units-queries.ts');
  // INSERT lists unit_uid as a column…
  ok(/INSERT INTO serial_units[\s\S]*unit_uid/.test(src), 'INSERT must include unit_uid');
  // …and UPDATE never clobbers an already-stamped id (the reprint guarantee).
  ok(/unit_uid = COALESCE\(unit_uid,/.test(src), 'UPDATE must COALESCE unit_uid, never overwrite');
  ok(/export async function findByUnitUid/.test(src), 'findByUnitUid reader must exist');
});

test('upsertSerialUnit mints unit_uid at birth (Phase 2) safely on the txn client', () => {
  const src = read('./serial-units-queries.ts');
  // Allocates the sequence on the same client (no second pooled connection).
  ok(/client\.query<\{ seq: number \}>\(\s*`SELECT fn_next_unit_seq/.test(src), 'mint must run fn_next_unit_seq on the txn client');
  // Guards: explicit uid wins, never overwrite an existing one, skip legacy origin.
  ok(/!resolvedUnitUid &&\s*!existingRow\?\.unit_uid/.test(src), 'mint only when no uid is provided AND the row has none');
  ok(/input\.origin_source !== 'legacy'/.test(src), 'legacy-origin rows must not auto-mint');
  // Best-effort: a mint failure must never break the core upsert.
  ok(/mint unit_uid failed \(non-fatal\)/.test(src), 'minting must be wrapped non-fatally');
});

test('mark-received off-flag path routes through upsertSerialUnit (bypass removed)', () => {
  const src = read('../../app/api/receiving/mark-received/route.ts');
  ok(/upsertSerialUnit\(/.test(src), 'off-flag path must create serials via the canonical writer');
  // Only the deliberate ON-flag v2 transaction (applyInventoryV2Effects) may
  // keep a raw INSERT; the off-flag `else if (serialNumber)` bypass is gone.
  const rawInserts = (src.match(/INSERT INTO serial_units/g) || []).length;
  equal(rawInserts, 1, 'exactly one raw serial_units INSERT (the v2-effects txn) may remain');
});
