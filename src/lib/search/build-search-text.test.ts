/**
 * DB-free unit tests for buildSearchText — fixture rows shaped exactly like
 * the worker loader SQL aliases (see search-outbox-worker.ts LOADER_SQL).
 * Run: npx tsx --test src/lib/search/build-search-text.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchText, isSearchEntityType, SEARCH_ENTITY_TYPES } from './build-search-text';

test('ORDER: title from product_title, subtitle mirrors global-search, facets mapped', () => {
  const doc = buildSearchText('ORDER', {
    id: 42,
    order_id: '12-34567-89012',
    product_title: 'Bose SoundLink Revolve',
    sku: 'BOSE-SLR-BLK',
    account_source: 'ebay',
    status: 'Shipped',
    condition: 'USED_GOOD',
    notes: 'gift wrap',
    order_date: '2026-06-01T12:00:00Z',
    created_at: '2026-05-30T12:00:00Z',
    serials: 'SN123 SN456',
    tracking_number: '1Z999AA10123456784',
  });
  assert.equal(doc.title, 'Bose SoundLink Revolve');
  assert.equal(doc.subtitle, '12-34567-89012 · SN123 SN456 · BOSE-SLR-BLK · ebay');
  for (const needle of ['12-34567-89012', 'SN123 SN456', '1Z999AA10123456784', 'ebay', 'gift wrap']) {
    assert.ok(doc.searchText.includes(needle), `searchText missing ${needle}`);
  }
  assert.equal(doc.facets.status, 'Shipped');
  assert.equal(doc.facets.conditionGrade, 'USED_GOOD');
  assert.equal(doc.facets.sourcePlatform, 'ebay');
  assert.equal(doc.facets.happenedAt?.toISOString(), '2026-06-01T12:00:00.000Z');
});

test('ORDER: falls back to "Order #id" title and created_at date', () => {
  const doc = buildSearchText('ORDER', { id: 7, created_at: '2026-01-02T00:00:00Z' });
  assert.equal(doc.title, 'Order #7');
  assert.equal(doc.subtitle, null);
  assert.equal(doc.facets.happenedAt?.toISOString(), '2026-01-02T00:00:00.000Z');
});

test('SERIAL_UNIT: items.name-preferred product title wins; serial in subtitle', () => {
  const doc = buildSearchText('SERIAL_UNIT', {
    id: 9,
    serial_number: 'ABC-123',
    unit_uid: 'BOSE-2626-000001',
    sku: 'BOSE-SLR',
    product_title: 'Bose SoundLink (Zoho name)',
    current_status: 'TESTED',
    condition_grade: 'USED_FAIR',
    current_location: 'BIN-A4',
    notes: null,
    received_at: '2026-06-20T00:00:00Z',
    created_at: '2026-06-19T00:00:00Z',
    shipping_tracking_number: null,
  });
  assert.equal(doc.title, 'Bose SoundLink (Zoho name)');
  assert.equal(doc.subtitle, 'ABC-123 · BOSE-SLR · TESTED');
  assert.ok(doc.searchText.includes('BOSE-2626-000001'));
  assert.ok(doc.searchText.includes('BIN-A4'));
  assert.equal(doc.facets.conditionGrade, 'USED_FAIR');
  assert.equal(doc.facets.status, 'TESTED');
});

test('RECEIVING: tracking title, line items searchable, source platform facet', () => {
  const doc = buildSearchText('RECEIVING', {
    id: 3,
    tracking_number: '9400111899560000000000',
    carrier: 'USPS',
    po_number: 'PO-00123',
    source_platform: 'ebay',
    intake_type: 'PO',
    exception_code: null,
    support_notes: 'left at dock',
    zoho_notes: null,
    quantity: '3',
    condition_grade: 'USED_GOOD',
    qa_status: 'PENDING',
    received_at: '2026-06-28T00:00:00Z',
    created_at: '2026-06-27T00:00:00Z',
    line_item_names: 'Samsung Galaxy S22 Sony WH-1000XM4',
    line_skus: 'SAM-S22 SONY-XM4',
  });
  assert.equal(doc.title, '9400111899560000000000');
  assert.equal(doc.subtitle, 'USPS · PO-00123 · ebay');
  assert.ok(doc.searchText.includes('Samsung Galaxy S22'));
  assert.ok(doc.searchText.includes('SAM-S22'));
  assert.equal(doc.facets.sourcePlatform, 'ebay');
  assert.equal(doc.facets.status, 'PENDING');
});

test('SKU: product_title title, identifiers searchable, lifecycle as status', () => {
  const doc = buildSearchText('SKU', {
    id: 11,
    sku: 'BOSE-901-IV',
    product_title: 'Bose 901 Series IV Speakers',
    category: 'Speakers',
    upc: '017817000000',
    ean: null,
    gtin: null,
    notes: 'ships freight',
    lifecycle_status: 'eol',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  });
  assert.equal(doc.title, 'Bose 901 Series IV Speakers');
  assert.equal(doc.subtitle, 'BOSE-901-IV · Speakers');
  assert.ok(doc.searchText.includes('017817000000'));
  assert.equal(doc.facets.status, 'eol');
  assert.equal(doc.facets.conditionGrade, null);
});

test('REPAIR: ticket + status subtitle; source refs searchable', () => {
  const doc = buildSearchText('REPAIR', {
    id: 5,
    ticket_number: 'RS-105',
    product_title: 'Denon AVR-X3700H',
    serial_number: 'DN998877',
    issue: 'No HDMI output',
    notes: null,
    status: 'Pending Repair',
    source_system: 'ebay',
    source_order_id: '11-22222-33333',
    source_tracking_number: null,
    source_sku: 'DENON-X3700',
    received_at: null,
    created_at: '2026-06-15T00:00:00Z',
  });
  assert.equal(doc.title, 'Denon AVR-X3700H');
  assert.equal(doc.subtitle, 'RS-105 · Pending Repair');
  assert.ok(doc.searchText.includes('No HDMI output'));
  assert.ok(doc.searchText.includes('11-22222-33333'));
  assert.equal(doc.facets.status, 'Pending Repair');
  assert.equal(doc.facets.happenedAt?.toISOString(), '2026-06-15T00:00:00.000Z');
});

test('FBA_SHIPMENT: shipment_ref title, aggregated item identifiers searchable', () => {
  const doc = buildSearchText('FBA_SHIPMENT', {
    id: 2,
    shipment_ref: 'FBA-2026-07-A',
    amazon_shipment_id: 'FBA15XYZ',
    destination_fc: 'ONT8',
    status: 'PACKING',
    notes: null,
    due_date: '2026-07-10',
    shipped_at: null,
    created_at: '2026-07-01T00:00:00Z',
    item_titles: 'Bose SoundLink Revolve',
    item_skus: 'BOSE-SLR',
    item_fnskus: 'X0012ABCDE',
    item_asins: 'B01N1RJ2C4',
  });
  assert.equal(doc.title, 'FBA-2026-07-A');
  assert.equal(doc.subtitle, 'PACKING · ONT8');
  assert.ok(doc.searchText.includes('X0012ABCDE'));
  assert.ok(doc.searchText.includes('B01N1RJ2C4'));
  assert.equal(doc.facets.sourcePlatform, 'fba');
  assert.equal(doc.facets.status, 'PACKING');
});

test('search text dedupes repeats, drops blanks, and caps length', () => {
  const doc = buildSearchText('SKU', {
    id: 1,
    sku: 'SAME',
    product_title: 'SAME',
    category: '',
    upc: null,
    notes: 'x'.repeat(5000),
  });
  assert.equal(doc.searchText.indexOf('SAME'), doc.searchText.lastIndexOf('SAME'));
  assert.ok(doc.searchText.length <= 2000);
});

test('isSearchEntityType guards the discriminator set', () => {
  for (const t of SEARCH_ENTITY_TYPES) assert.equal(isSearchEntityType(t), true);
  assert.equal(isSearchEntityType('WALK_IN_ORDER'), false);
  assert.equal(isSearchEntityType('order'), false); // DB values are uppercase
});
