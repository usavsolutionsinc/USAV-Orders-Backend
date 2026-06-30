import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  getReceivingStatusDot,
  getReceivingStatusDotLabel,
  getUnboxRecentStatusDot,
  getUnboxRecentStatusDotLabel,
} from './status';

function row(overrides: Partial<ReceivingLineRow> = {}): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: 10,
    tracking_number: '1Z999',
    carrier: 'UPS',
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: 'PO-1',
    zoho_purchaseorder_number: 'PO-1',
    item_name: 'Widget',
    sku: 'WDG',
    quantity_received: 0,
    quantity_expected: 1,
    qa_status: 'PENDING',
    workflow_status: 'MATCHED',
    disposition_code: 'HOLD',
    condition_grade: 'BRAND_NEW',
    disposition_audit: [],
    needs_test: true,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    receiving_type: 'PO',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    receiving_source: 'po',
    ...overrides,
  };
}

test('getReceivingStatusDotLabel — door-scanned matched carton reads Scanned', () => {
  const r = row({ workflow_status: 'MATCHED', quantity_received: 0 });
  assert.equal(getReceivingStatusDotLabel(r), 'Scanned');
  assert.ok(getReceivingStatusDot(r).includes('blue') || getReceivingStatusDot(r).includes('sky'));
});

test('getUnboxRecentStatusDot — door-scanned matched carton reads Received in Unboxed rail', () => {
  const r = row({ workflow_status: 'MATCHED', quantity_received: 0 });
  assert.equal(getUnboxRecentStatusDotLabel(r), 'Received');
  assert.equal(getUnboxRecentStatusDot(r), 'bg-emerald-500');
});

test('getUnboxRecentStatusDot — unfound carton in Unboxed rail reads Received', () => {
  const r = row({
    receiving_source: 'unmatched',
    workflow_status: 'ARRIVED',
    quantity_received: 0,
    zoho_purchaseorder_id: null,
  });
  assert.equal(getUnboxRecentStatusDotLabel(r), 'Received');
  assert.equal(getUnboxRecentStatusDot(r), 'bg-emerald-500');
});

test('getUnboxRecentStatusDot — testing phase reads Received (emerald)', () => {
  const r = row({ workflow_status: 'IN_TEST' });
  assert.equal(getUnboxRecentStatusDot(r), 'bg-emerald-500');
  assert.equal(getUnboxRecentStatusDotLabel(r), 'Received');
});
