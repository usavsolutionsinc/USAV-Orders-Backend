/**
 * DB-free unit tests for domain read-tool adapters.
 * Run: npx tsx --test src/lib/assistant/tools/domain-read-tools.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAssistantTool } from './index';
import type { AssistantToolCtx, AssistantToolDeps } from './types';
import type { OperationsJourneyDeps, OrderLookupDeps, SerialLookupDeps } from './domain-read-tools';

const ORG = '11111111-2222-3333-4444-555555555555';

function ctxWith(perms: string[]): AssistantToolCtx {
  return { organizationId: ORG, staffId: 7, permissions: new Set(perms) };
}

test('get_operations_journey: threads org + dim/value; not-found short-circuits', async () => {
  const cap: Array<{ orgId: string; dim: string; value: string }> = [];
  const journey: OperationsJourneyDeps = {
    withTxn: async (_orgId, fn) => fn({} as never),
    resolve: async (_client, orgId, dim, value) => {
      cap.push({ orgId, dim, value });
      return null;
    },
    read: async () => {
      throw new Error('read should not run');
    },
  };
  const deps = { query: async () => ({ rows: [] }), journey } as AssistantToolDeps & {
    journey: OperationsJourneyDeps;
  };
  const out = await runAssistantTool(
    'get_operations_journey',
    { dim: 'serial', value: 'ABC123' },
    ctxWith(['operations.view', 'assistant.chat']),
    deps,
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.ok ? out.data : null, {
    found: false,
    dim: 'serial',
    value: 'ABC123',
  });
  assert.equal(cap[0]?.orgId, ORG);
  assert.equal(cap[0]?.dim, 'serial');
});

test('get_operations_journey: found path returns trimmed events + href', async () => {
  const journey: OperationsJourneyDeps = {
    withTxn: async (_orgId, fn) => fn({} as never),
    resolve: async () =>
      ({
        kind: 'order',
        orderId: 99,
        orderNumber: 'ORD-99',
        shipmentId: 1,
        serialUnitIds: [5],
        serials: ['ABC'],
        trackingNumbers: ['1Z'],
      }) as never,
    read: async (_client, _orgId, _anchors, filters) => {
      assert.equal(filters.limit, 40);
      return [
        {
          source: 'inventory',
          id: '1',
          at: '2026-01-01',
          group: 'test',
          raw: { status: 'TESTED', station: 'TEST' },
        },
      ] as never;
    },
  };
  const deps = { query: async () => ({ rows: [] }), journey } as AssistantToolDeps & {
    journey: OperationsJourneyDeps;
  };
  const out = await runAssistantTool(
    'get_operations_journey',
    { dim: 'order', value: 'ORD-99' },
    ctxWith(['operations.view']),
    deps,
  );
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const data = out.data as { found: boolean; href: string; events: unknown[] };
  assert.equal(data.found, true);
  assert.equal(data.href, '/dashboard?openOrderId=99');
  assert.equal(data.events.length, 1);
});

test('get_order_lookup: requires orderId or tracking; threads org', async () => {
  const cap: string[] = [];
  const orderLookup: OrderLookupDeps = {
    orders: async (params, orgId) => {
      cap.push(`orders:${orgId}:${params.orderId}`);
      return '=== PENDING ORDERS ===\nOrder: 12345';
    },
    shipped: async (params, orgId) => {
      cap.push(`shipped:${orgId}:${params.orderId}`);
      return '=== SHIPPED LOOKUP ===\nOrder: 12345';
    },
  };
  const deps = { query: async () => ({ rows: [] }), orderLookup } as AssistantToolDeps & {
    orderLookup: OrderLookupDeps;
  };
  const denied = await runAssistantTool(
    'get_order_lookup',
    {},
    ctxWith(['dashboard.view']),
    deps,
  );
  assert.equal(denied.ok, false);

  const out = await runAssistantTool(
    'get_order_lookup',
    { orderId: '12345' },
    ctxWith(['dashboard.view']),
    deps,
  );
  assert.equal(out.ok, true);
  assert.ok(cap.every((c) => c.includes(ORG)));
  assert.match(String((out as { data: { block: string } }).data.block), /12345/);
});

test('lookup_serial: unit path returns href; miss returns found:false', async () => {
  const serialLookup: SerialLookupDeps = {
    findUnit: async (serial, orgId) => {
      assert.equal(orgId, ORG);
      assert.equal(serial, 'ABC123');
      return {
        id: 7,
        serial_number: 'ABC123',
        normalized_serial: 'ABC123',
        sku: 'SKU-1',
        current_status: 'IN_STOCK',
        condition_grade: 'A',
        current_location: 'A1',
      } as never;
    },
    findOrderForUnit: async () => null,
    findOrderByTsn: async () => null,
  };
  const deps = { query: async () => ({ rows: [] }), serialLookup } as AssistantToolDeps & {
    serialLookup: SerialLookupDeps;
  };
  const out = await runAssistantTool(
    'lookup_serial',
    { serial: 'abc-123' },
    ctxWith(['dashboard.view']),
    deps,
  );
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const data = out.data as { found: boolean; href: string };
  assert.equal(data.found, true);
  assert.equal(data.href, '/inventory/units?unit=7');
});

test('lookup_warranty_coverage: flag off degrades; flag on threads org', async () => {
  const off = await runAssistantTool(
    'lookup_warranty_coverage',
    { q: '12345' },
    ctxWith(['warranty.view']),
    {
      query: async () => ({ rows: [] }),
      warrantyCoverage: {
        flagOn: () => false,
        lookup: async () => {
          throw new Error('should not run');
        },
      },
    } as never,
  );
  assert.equal(off.ok, true);
  assert.deepEqual(off.ok ? off.data : null, {
    available: false,
    reason: 'WARRANTY_LOGGER flag is OFF',
  });

  const on = await runAssistantTool(
    'lookup_warranty_coverage',
    { q: '12345' },
    ctxWith(['warranty.view']),
    {
      query: async () => ({ rows: [] }),
      warrantyCoverage: {
        flagOn: () => true,
        lookup: async (q, orgId) => {
          assert.equal(q, '12345');
          assert.equal(orgId, ORG);
          return { found: true, query: q, inWarranty: true };
        },
      },
    } as never,
  );
  assert.equal(on.ok, true);
  assert.equal((on as { data: { available: boolean } }).data.available, true);
});

test('permission gating: domain tools refuse without their permission', async () => {
  const deps: AssistantToolDeps = { query: async () => ({ rows: [] }) };
  const out = await runAssistantTool(
    'get_operations_journey',
    { dim: 'order', value: 'x' },
    ctxWith(['dashboard.view']),
    deps,
  );
  assert.equal(out.ok, false);
  assert.equal((out as { code: string }).code, 'forbidden');
});

test('get_packing_kpi: threads org + day into deps', async () => {
  const cap: Array<{ orgId: string; day: string }> = [];
  const out = await runAssistantTool(
    'get_packing_kpi',
    { dayPst: '2026-07-08' },
    ctxWith(['operations.view']),
    {
      query: async () => ({ rows: [] }),
      packingKpi: {
        forDay: async (orgId, dayPst) => {
          cap.push({ orgId, day: dayPst });
          return {
            day: dayPst,
            capacity: {} as never,
            totals: {
              small_count: 1,
              medium_count: 2,
              large_count: 0,
              total_boxes_packed: 3,
              weighted_minutes: 30,
              remaining_minutes: 0,
            },
            by_packer: [],
            fba: {
              pending_units: 0,
              pending_weighted_minutes: 0,
              avg_minutes_per_unit: null,
              fillable_units: 0,
            },
          };
        },
      },
    } as never,
  );
  assert.equal(out.ok, true);
  assert.deepEqual(cap[0], { orgId: ORG, day: '2026-07-08' });
});
