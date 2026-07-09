import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRealZohoPoId,
  isSalesOrderLinkage,
  shouldUseLocalReceiveOnly,
  shouldUsePoAccordion,
  shouldUseUnmatchedItemsSurface,
  isSalesOrderDerivedCarton,
} from './intake-items-routing';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

function row(partial: Partial<ReceivingLineRow>): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: 10,
    tracking_number: null,
    carrier: null,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
    item_name: 'Item',
    sku: null,
    quantity_received: 0,
    quantity_expected: 1,
    qa_status: 'PENDING',
    workflow_status: 'ARRIVED',
    disposition_code: 'HOLD',
    condition_grade: 'USED_A',
    disposition_audit: [],
    needs_test: true,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    receiving_type: 'PO',
    notes: null,
    created_at: null,
    image_url: null,
    source_platform: null,
    receiving_source: 'zoho_po',
    ...partial,
  };
}

test('hasRealZohoPoId: trims and rejects empty', () => {
  assert.equal(hasRealZohoPoId({ zoho_purchaseorder_id: ' 5623 ' }), true);
  assert.equal(hasRealZohoPoId({ zoho_purchaseorder_id: null }), false);
  assert.equal(hasRealZohoPoId({ zoho_purchaseorder_id: '   ' }), false);
});

test('isSalesOrderLinkage: zoho_po without real id', () => {
  assert.equal(
    isSalesOrderLinkage(row({ receiving_source: 'zoho_po', zoho_purchaseorder_id: null })),
    true,
  );
  assert.equal(
    isSalesOrderLinkage(row({ receiving_source: 'zoho_po', zoho_purchaseorder_id: '99' })),
    false,
  );
});

test('shouldUseUnmatchedItemsSurface: unmatched + return + sales-order link', () => {
  assert.equal(shouldUseUnmatchedItemsSurface(row({ receiving_source: 'unmatched' })), true);
  assert.equal(
    shouldUseUnmatchedItemsSurface(row({ carton_intake_type: 'RETURN', receiving_source: 'zoho_po' })),
    true,
  );
  assert.equal(
    shouldUseUnmatchedItemsSurface(
      row({ receiving_source: 'zoho_po', zoho_purchaseorder_number: '112-1', zoho_purchaseorder_id: null }),
    ),
    true,
  );
});

test('shouldUsePoAccordion: only real Zoho PO cartons', () => {
  assert.equal(
    shouldUsePoAccordion(row({ receiving_source: 'zoho_po', zoho_purchaseorder_id: '5623' })),
    true,
  );
  assert.equal(
    shouldUsePoAccordion(row({ receiving_source: 'zoho_po', zoho_purchaseorder_id: null, carton_intake_type: 'RETURN' })),
    false,
  );
  assert.equal(shouldUsePoAccordion(row({ receiving_id: null })), false);
});

test('isSalesOrderDerivedCarton: server carton row without Zoho PO id', () => {
  assert.equal(
    isSalesOrderDerivedCarton({ source: 'zoho_po', zoho_purchaseorder_id: null }),
    true,
  );
  assert.equal(
    isSalesOrderDerivedCarton({ source: 'zoho_po', zoho_purchaseorder_id: '5623' }),
    false,
  );
  assert.equal(
    isSalesOrderDerivedCarton({ source: 'unmatched', zoho_purchaseorder_id: null }),
    false,
  );
});

test('shouldUseLocalReceiveOnly mirrors unmatched-items surface', () => {
  assert.equal(shouldUseLocalReceiveOnly(row({ receiving_source: 'unmatched' })), true);
  assert.equal(
    shouldUseLocalReceiveOnly(row({ carton_intake_type: 'RETURN', receiving_source: 'zoho_po' })),
    true,
  );
  assert.equal(
    shouldUseLocalReceiveOnly(row({ receiving_source: 'zoho_po', zoho_purchaseorder_id: '99' })),
    false,
  );
});
