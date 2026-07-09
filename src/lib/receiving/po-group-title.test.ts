import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  getReceivingPoGroupTitle,
  isReceivingPoGroupTitleRow,
  receivingAdaptiveRailTitle,
  receivingRailRowTitle,
  stampPoRailTitleContext,
} from './po-group-title';

const identity = (raw: string) => raw;

function row(overrides: Partial<ReceivingLineRow> = {}): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: 10,
    tracking_number: '1Z999',
    carrier: 'UPS',
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
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
    ...overrides,
  };
}

test('getReceivingPoGroupTitle — Zoho PO 63598685', () => {
  const r = row({
    zoho_purchaseorder_number: '63598685',
    zoho_purchaseorder_id: '63598685',
    item_name: '(2) Bose Companion 2 Series II Multimedia Speakers',
  });
  assert.equal(getReceivingPoGroupTitle(r, identity), 'PO 63598685');
});

test('getReceivingPoGroupTitle — platform prefix when source_platform set', () => {
  const r = row({
    zoho_purchaseorder_number: '63598685',
    source_platform: 'amazon',
  });
  assert.equal(getReceivingPoGroupTitle(r, (p) => (p === 'amazon' ? 'Amazon' : p)), 'Amazon · PO 63598685');
});

test('isReceivingPoGroupTitleRow — unfound stub is excluded', () => {
  const r = row({
    receiving_source: 'unmatched',
    item_name: 'Unfound PO',
    zoho_purchaseorder_number: null,
  });
  assert.equal(isReceivingPoGroupTitleRow(r), false);
});

test('receivingRailRowTitle — po-group mode keeps unfound product label', () => {
  const r = row({
    receiving_source: 'unmatched',
    item_name: 'Unfound PO',
  });
  assert.equal(receivingRailRowTitle(r, 'po-group', identity), 'Unfound PO');
});

test('receivingRailRowTitle — marketplace order without Zoho PO', () => {
  const r = row({
    receiving_source: 'ebay',
    inbound_source_type: 'ebay',
    source_order_id: '12-34567-89012',
    platform_account_label: 'USAV-Buyer',
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
    item_name: 'Vintage receiver',
  });
  assert.equal(
    receivingRailRowTitle(r, 'po-group', (p) => (p === 'ebay' ? 'eBay' : p)),
    'eBay · USAV-Buyer · Order 12-34567-89012',
  );
});

test('receivingRailRowTitle — line mode keeps product name', () => {
  const r = row({
    zoho_purchaseorder_number: '63598685',
    item_name: '(2) Bose Companion 2 Series II Multimedia Speakers',
  });
  assert.equal(
    receivingRailRowTitle(r, 'line', identity),
    '(2) Bose Companion 2 Series II Multimedia Speakers',
  );
});

test('receivingAdaptiveRailTitle — single SKU shows product title', () => {
  const r = row({
    zoho_purchaseorder_number: '63598685',
    item_name: 'Single product',
    rail_title_context: { line_count: 1, distinct_sku_count: 1 },
  });
  assert.equal(receivingAdaptiveRailTitle(r, identity), 'Single product');
});

test('receivingAdaptiveRailTitle — multi distinct SKU shows PO summary', () => {
  const r = row({
    zoho_purchaseorder_number: '63598685',
    source_platform: 'goodwill',
    item_name: 'First product',
    rail_title_context: { line_count: 3, distinct_sku_count: 3 },
  });
  assert.equal(
    receivingAdaptiveRailTitle(r, (p) => (p === 'goodwill' ? 'Goodwill' : p)),
    'Goodwill · PO 63598685',
  );
});

test('receivingAdaptiveRailTitle — multi line same SKU shows product title', () => {
  const r = row({
    zoho_purchaseorder_number: '63598685',
    item_name: 'Same widget',
    sku: 'WDG-1',
    rail_title_context: { line_count: 2, distinct_sku_count: 1 },
  });
  assert.equal(receivingAdaptiveRailTitle(r, identity), 'Same widget');
});

test('receivingAdaptiveRailTitle — eBay single order shows product title', () => {
  const [stamped] = stampPoRailTitleContext([
    row({
      id: 42,
      inbound_source_type: 'ebay',
      source_order_id: '05-14843-41472',
      item_name: 'Vintage amp',
      sku: 'AMP-1',
      zoho_purchaseorder_id: null,
      zoho_purchaseorder_number: null,
    }),
  ]);
  assert.equal(receivingAdaptiveRailTitle(stamped, (p) => (p === 'ebay' ? 'eBay' : p)), 'Vintage amp');
});
