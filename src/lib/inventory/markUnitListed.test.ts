/**
 * DB-free unit tests for markUnitListed() — exercises the helper through injected
 * fakes (no Postgres). Mirrors the applyTransition.test.ts pattern: a fakes()
 * factory captures every collaborator call so we assert on both the return value
 * and what got threaded into the deps.
 *
 *   node --import tsx --test src/lib/inventory/markUnitListed.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { markUnitListed, type MarkUnitListedDeps } from './markUnitListed';
import type { RecordInventoryEventInput } from './events';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

interface QueryCall {
  sql: string;
  params: unknown[];
}

/**
 * Build injectable deps with a fake tenant tx + a fake serial_units / listings
 * query responder, plus a fake recordEvent. `opts` lets each test pick what the
 * unit lock returns (null → 404) and whether the UPSERT inserted vs re-listed.
 */
function fakes(opts: {
  unitRow?: { id: number; sku: string | null } | null;
  inserted?: boolean;
  eventThrows?: boolean;
} = {}) {
  const queries: QueryCall[] = [];
  const events: RecordInventoryEventInput[] = [];
  let txOrg: OrgId | null = null;

  const fakeClient: Pick<PoolClient, 'query'> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM serial_units/i.test(sql)) {
        const unitRow = opts.unitRow === undefined ? { id: 42, sku: 'SKU-1' } : opts.unitRow;
        return { rows: unitRow ? [unitRow] : [] };
      }
      if (/INTO serial_unit_listings/i.test(sql)) {
        return { rows: [{ id: 777, inserted: opts.inserted ?? true }] };
      }
      return { rows: [] };
    }) as PoolClient['query'],
  };

  const deps: MarkUnitListedDeps = {
    withTx: async (orgId, fn) => {
      txOrg = orgId;
      return fn(fakeClient);
    },
    recordEvent: async (input) => {
      events.push(input);
      if (opts.eventThrows) throw new Error('event boom');
      return { id: 901 };
    },
  };

  return { deps, queries, events, getTxOrg: () => txOrg };
}

test('happy path: inserts a listing + LISTED event, idempotent=false', async () => {
  const f = fakes({ inserted: true });
  const res = await markUnitListed(
    { unitId: 42, orgId: ORG, externalRefId: 'EBAY-123', listingPriceCents: 4999, actorStaffId: 7 },
    f.deps,
  );

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.serialUnitId, 42);
  assert.equal(res.listingId, 777);
  assert.equal(res.platform, 'ebay'); // default
  assert.equal(res.externalRefId, 'EBAY-123');
  assert.equal(res.idempotent, false);
  assert.equal(res.eventId, 901);

  // tx scoped to the org.
  assert.equal(f.getTxOrg(), ORG);

  // Unit lock is org-scoped (404 surface for cross-tenant ids).
  const unitQ = f.queries.find((q) => /FROM serial_units/i.test(q.sql));
  assert.ok(unitQ);
  assert.deepEqual(unitQ!.params, [42, ORG]);

  // Listing UPSERT threads platform + external ref + price + staff.
  const upsert = f.queries.find((q) => /INTO serial_unit_listings/i.test(q.sql));
  assert.ok(upsert);
  assert.deepEqual(upsert!.params, [ORG, 42, 'SKU-1', 'ebay', 'EBAY-123', 4999, 7]);

  // Exactly one LISTED event, carrying the listing linkage, no status change.
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].event_type, 'LISTED');
  assert.equal(f.events[0].serial_unit_id, 42);
  const payload = f.events[0].payload as Record<string, unknown>;
  assert.equal(payload.platform, 'ebay');
  assert.equal(payload.listing_id, 777);
  assert.equal(payload.relist, false);
});

test('re-list of an existing row returns idempotent=true', async () => {
  const f = fakes({ inserted: false });
  const res = await markUnitListed({ unitId: 42, orgId: ORG, platform: 'Amazon' }, f.deps);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.idempotent, true);
  assert.equal(res.platform, 'amazon'); // normalized lower-case
  // relist flag propagates to the event payload.
  assert.equal((f.events[0].payload as Record<string, unknown>).relist, true);
});

test('unknown / cross-tenant unit → 404, no listing, no event', async () => {
  const f = fakes({ unitRow: null });
  const res = await markUnitListed({ unitId: 999, orgId: ORG }, f.deps);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.status, 404);
  // No UPSERT, no event fired.
  assert.ok(!f.queries.some((q) => /INTO serial_unit_listings/i.test(q.sql)));
  assert.equal(f.events.length, 0);
});

test('a LISTED event failure is non-fatal — the listing still succeeds', async () => {
  const f = fakes({ inserted: true, eventThrows: true });
  const res = await markUnitListed({ unitId: 42, orgId: ORG }, f.deps);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.listingId, 777);
  assert.equal(res.eventId, null); // event threw → captured as null, not propagated
});
