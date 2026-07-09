import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TechRecord } from '@/hooks/useTechLogs';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import {
  getStationSourceKind,
  getStationSourceRecord,
  packerRecordToQueueRow,
  techRecordToQueueRow,
} from './record-to-queue-row';

const techBase: TechRecord = {
  id: 42,
  created_at: '2026-07-01T18:00:00Z',
  shipping_tracking_number: '9400100000000000000000',
  serial_number: 'SN-TECH-1',
  tested_by: 7,
  order_id: 'ORD-100',
  product_title: 'Bose QC45',
  quantity: '2',
  condition: 'USED',
  sku: 'SKU-1',
  account_source: 'Goodwill',
  fnsku: null,
};

const packerBase: PackerRecord = {
  id: 84,
  created_at: '2026-07-02T18:00:00Z',
  scan_ref: 'X00ABCDEF1',
  shipping_tracking_number: '9400100000000000000001',
  packed_by: 9,
  tracking_type: 'usps',
  order_id: 'ORD-200',
  account_source: 'fba',
  product_title: 'Sony WH-1000XM4',
  quantity: '1',
  condition: 'NEW',
  sku: 'SKU-2',
  packer_photos_url: [],
};

test('techRecordToQueueRow maps identity + banding + tester and stashes the source', () => {
  const row = techRecordToQueueRow(techBase);
  assert.equal(row.id, 42);
  assert.equal(row.order_id, 'ORD-100');
  assert.equal(row.product_title, 'Bose QC45');
  assert.equal(row.sku, 'SKU-1');
  assert.equal(row.serial_number, 'SN-TECH-1');
  assert.equal(row.shipping_tracking_number, '9400100000000000000000');
  assert.equal(row.account_source, 'Goodwill');
  // Tech rows band by scan time → both created_at and deadline_at are created_at.
  assert.equal(row.created_at, techBase.created_at);
  assert.equal(row.deadline_at, techBase.created_at);
  // Tester comes from tested_by; no packer.
  assert.equal(row.tested_by, 7);
  assert.equal(row.tester_id, 7);
  assert.equal(row.packed_by, null);
  // Source round-trips for detail-open / copy.
  assert.equal(getStationSourceKind(row), 'tech');
  assert.deepEqual(getStationSourceRecord<TechRecord>(row), techBase);
});

test('techRecordToQueueRow falls back to safe defaults for absent fields', () => {
  const row = techRecordToQueueRow({ ...techBase, order_id: null, product_title: null, quantity: undefined, sku: null });
  assert.equal(row.order_id, '');
  assert.equal(row.product_title, 'Unknown Product');
  assert.equal(row.quantity, '1');
  assert.equal(row.sku, '');
});

test('packerRecordToQueueRow maps FNSKU/scan_ref + packer and stashes the source', () => {
  const row = packerRecordToQueueRow(packerBase);
  assert.equal(row.id, 84);
  assert.equal(row.order_id, 'ORD-200');
  assert.equal(row.product_title, 'Sony WH-1000XM4');
  assert.equal(row.scan_ref, 'X00ABCDEF1');
  assert.equal(row.packed_by, 9);
  assert.equal(row.packer_id, 9);
  assert.equal(row.created_at, packerBase.created_at);
  // No deadline on the source → bands by created_at.
  assert.equal(row.deadline_at, packerBase.created_at);
  assert.equal(getStationSourceKind(row), 'packer');
  assert.deepEqual(getStationSourceRecord<PackerRecord>(row), packerBase);
});

test('packerRecordToQueueRow title falls back to item_number then sku', () => {
  const noTitle = packerRecordToQueueRow({ ...packerBase, product_title: null, item_number: 'ITEM-9', sku: 'SKU-9' });
  assert.equal(noTitle.product_title, 'ITEM-9');
  const noTitleNoItem = packerRecordToQueueRow({ ...packerBase, product_title: null, item_number: null, sku: 'SKU-9' });
  assert.equal(noTitleNoItem.product_title, 'SKU-9');
});
