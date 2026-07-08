import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  displayTrackingNumber,
  fulfillmentModeLabel,
  isLocalPickupFulfillment,
  isPlaceholderTracking,
} from './fulfillment-mode';

function row(overrides: Partial<ReceivingLineRow> = {}): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: 10,
    tracking_number: '1Z999',
    carrier: 'UPS',
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: '63598685',
    zoho_purchaseorder_number: '63598685',
    item_name: 'Widget',
    sku: 'WDG',
    quantity_received: 1,
    quantity_expected: 1,
    qa_status: 'PENDING',
    workflow_status: 'DONE',
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
    receiving_source: 'zoho_po',
    source_platform: 'goodwill',
    ...overrides,
  };
}

test('isPlaceholderTracking — Local Pickup literal', () => {
  assert.equal(isPlaceholderTracking('Local Pickup'), true);
  assert.equal(isPlaceholderTracking('local pickup'), true);
  assert.equal(isPlaceholderTracking('1Z999'), false);
});

test('isLocalPickupFulfillment — Goodwill PO with Local Pickup reference', () => {
  const r = row({ tracking_number: 'Local Pickup', source_platform: 'goodwill' });
  assert.equal(isLocalPickupFulfillment(r), true);
  assert.equal(fulfillmentModeLabel(r), 'Pickup');
  assert.equal(displayTrackingNumber(r), null);
});

test('isLocalPickupFulfillment — shipped Goodwill keeps tracking', () => {
  const r = row({ tracking_number: '1Z999AA', carrier: 'UPS' });
  assert.equal(isLocalPickupFulfillment(r), false);
  assert.equal(displayTrackingNumber(r), '1Z999AA');
});

test('isLocalPickupFulfillment — receiving_source local_pickup', () => {
  const r = row({ receiving_source: 'local_pickup', tracking_number: null });
  assert.equal(isLocalPickupFulfillment(r), true);
});

test('isLocalPickupFulfillment — carton intake PICKUP', () => {
  const r = row({ carton_intake_type: 'PICKUP', tracking_number: null, carrier: null });
  assert.equal(isLocalPickupFulfillment(r), true);
});
