/**
 * Orchestration guards for recordUnitEvent() — the transactional unit
 * lifecycle façade (relational-reuse plan, Phase 2).
 *
 * Drives the real upsertSerialUnit new-unit path through a SQL-routing mock
 * client (no DB) and asserts the four writes sequence correctly:
 *   serial_units → tech_serial_numbers → sku_stock_ledger → inventory_events,
 * with the event row linked to the ledger row, and the optional tech/ledger
 * writes actually skipped when not requested.
 */

import { test } from 'node:test';
import { equal, ok } from 'node:assert';
import type { PoolClient } from 'pg';
import { recordUnitEvent } from './unit-events';

const UNIT_ROW = {
  id: 1,
  serial_number: 'SN1',
  normalized_serial: 'SN1',
  sku: 'SKU1',
  sku_catalog_id: null,
  zoho_item_id: null,
  current_status: 'RECEIVED',
  current_location: null,
  condition_grade: null,
  origin_source: 'receiving',
  origin_receiving_line_id: 9,
  origin_tsn_id: null,
  origin_sku_id: null,
  received_at: null,
  received_by: null,
  notes: null,
  metadata: {},
  created_at: '2026-06-06T00:00:00Z',
  updated_at: '2026-06-06T00:00:00Z',
};

interface Call { text: string; params: unknown[]; }

/** Mock pg client that routes by SQL and records every call. */
function mockClient() {
  const calls: Call[] = [];
  const find = (re: RegExp) => calls.find((c) => re.test(c.text));
  const client = {
    calls,
    find,
    async query<T>(text: string, params?: unknown[]) {
      calls.push({ text, params: params ?? [] });
      if (/INSERT INTO serial_units/.test(text)) return { rows: [UNIT_ROW] as T[], rowCount: 1 };
      if (/INSERT INTO tech_serial_numbers/.test(text)) return { rows: [{ id: 201 }] as T[], rowCount: 1 };
      if (/INSERT INTO sku_stock_ledger/.test(text)) return { rows: [{ id: 301 }] as T[], rowCount: 1 };
      if (/INSERT INTO inventory_events/.test(text)) return { rows: [{ id: 401 }] as T[], rowCount: 1 };
      // SELECT ... FOR UPDATE (new-unit path) + anything else.
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return client;
}

test('recordUnitEvent sequences upsert → tech → ledger → event, linking the event to the ledger', async () => {
  const client = mockClient();
  const result = await recordUnitEvent(
    {
      serialNumber: 'sn1',
      sku: 'SKU1',
      originSource: 'receiving',
      originReceivingLineId: 9,
      eventType: 'RECEIVED',
      station: 'RECEIVING',
      actorStaffId: 7,
      receivingLineId: 9,
      targetStatus: 'RECEIVED',
      ledger: { delta: 1, reason: 'RECEIVED', refReceivingLineId: 9 },
    },
    client as unknown as PoolClient,
  );

  equal(result.isNew, true);
  equal(result.techSerialId, 201);
  equal(result.ledgerId, 301);
  equal(result.eventId, 401);

  // All four writes happened, in order.
  const order = ['serial_units', 'tech_serial_numbers', 'sku_stock_ledger', 'inventory_events']
    .map((t) => client.calls.findIndex((c) => new RegExp(`INSERT INTO ${t}`).test(c.text)));
  ok(order.every((i) => i >= 0), 'all four inserts fired');
  ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'inserts are in spine order');

  // The event row is linked to the ledger row (stock_ledger_id param = ledger id).
  const evt = client.find(/INSERT INTO inventory_events/)!;
  equal(evt.params[11], 301, 'inventory_events.stock_ledger_id = ledger id');
  equal(evt.params[5], 1, 'inventory_events.serial_unit_id = unit id');
});

test('recordUnitEvent skips lineage + ledger when not requested', async () => {
  const client = mockClient();
  const result = await recordUnitEvent(
    {
      serialNumber: 'sn1',
      sku: 'SKU1',
      originSource: 'manual',
      eventType: 'NOTE',
      station: 'SYSTEM',
      writeTechSerial: false,
      // no ledger
    },
    client as unknown as PoolClient,
  );

  equal(result.techSerialId, null);
  equal(result.ledgerId, null);
  equal(result.eventId, 401);
  ok(!client.find(/INSERT INTO tech_serial_numbers/), 'no lineage row written');
  ok(!client.find(/INSERT INTO sku_stock_ledger/), 'no ledger row written');
  const evt = client.find(/INSERT INTO inventory_events/)!;
  equal(evt.params[11], null, 'event has no stock_ledger link');
});

test('recordUnitEvent throws on an invalid serial (rolls back via caller txn)', async () => {
  const client = mockClient();
  let threw = false;
  try {
    await recordUnitEvent(
      { serialNumber: '   ', originSource: 'manual', eventType: 'NOTE' },
      client as unknown as PoolClient,
    );
  } catch {
    threw = true;
  }
  ok(threw, 'invalid serial must throw');
  ok(!client.find(/INSERT INTO inventory_events/), 'no event written on invalid serial');
});
