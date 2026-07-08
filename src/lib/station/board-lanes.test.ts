import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bucketTechHistoryLane,
  isFbaTechLaneRow,
  TECH_HISTORY_BOARD_LANES,
} from './tech-board-lanes';
import {
  bucketPackerHistoryLane,
  isFbaPackerLaneRow,
  PACKER_HISTORY_BOARD_LANES,
} from './packer-board-lanes';
import { bucketTestingHistoryLane, TESTING_HISTORY_BOARD_LANES } from './testing-board-lanes';
import {
  bucketReceivingIncomingLane,
  bucketReceivingHistoryLane,
  RECEIVING_INCOMING_BOARD_LANES,
  RECEIVING_HISTORY_BOARD_LANES,
} from '@/lib/receiving/receiving-board-lanes';

const TODAY = '2026-07-06';
const EARLIER = '2026-07-01T18:00:00Z'; // an earlier day (PST)
const TODAY_TS = '2026-07-06T18:00:00Z';

test('tech lanes: FBA wins over day banding; else today vs this-week', () => {
  assert.equal(bucketTechHistoryLane({ created_at: TODAY_TS, account_source: 'fba' }, TODAY), 'FBA');
  assert.equal(bucketTechHistoryLane({ created_at: TODAY_TS, fnsku: 'X00ABCDEF1' }, TODAY), 'FBA');
  assert.equal(bucketTechHistoryLane({ created_at: TODAY_TS, order_id: 'FBA' }, TODAY), 'FBA');
  assert.equal(bucketTechHistoryLane({ created_at: TODAY_TS, account_source: 'ebay' }, TODAY), 'TODAY');
  assert.equal(bucketTechHistoryLane({ created_at: EARLIER, account_source: 'ebay' }, TODAY), 'THIS_WEEK');
});

test('tech FBA predicate matches isFbaTechRecord shape', () => {
  assert.equal(isFbaTechLaneRow({ source_kind: 'fba_scan' }), true);
  assert.equal(isFbaTechLaneRow({ account_source: 'fba' }), true);
  assert.equal(isFbaTechLaneRow({ fnsku: ' X001 ' }), true);
  assert.equal(isFbaTechLaneRow({ order_id: 'fba' }), true);
  assert.equal(isFbaTechLaneRow({ order_id: 'ORD-1', account_source: 'ebay' }), false);
});

test('tech lane descriptors are the canonical 3 in order', () => {
  assert.deepEqual(TECH_HISTORY_BOARD_LANES.map((l) => l.id), ['TODAY', 'THIS_WEEK', 'FBA']);
});

test('packer lanes: EXCEPTION > FBA > day banding', () => {
  assert.equal(bucketPackerHistoryLane({ created_at: TODAY_TS, row_source: 'exception', account_source: 'fba' }, TODAY), 'EXCEPTION');
  assert.equal(bucketPackerHistoryLane({ created_at: TODAY_TS, account_source: 'fba' }, TODAY), 'FBA');
  assert.equal(bucketPackerHistoryLane({ created_at: TODAY_TS, tracking_type: 'FNSKU' }, TODAY), 'FBA');
  assert.equal(bucketPackerHistoryLane({ created_at: TODAY_TS, order_id: 'ORD-1', account_source: 'ebay' }, TODAY), 'TODAY');
  assert.equal(bucketPackerHistoryLane({ created_at: EARLIER, order_id: 'ORD-1', account_source: 'ebay' }, TODAY), 'THIS_WEEK');
});

test('packer FBA predicate matches isFbaPackerRecord (FBA order OR FNSKU tracking)', () => {
  assert.equal(isFbaPackerLaneRow({ order_id: 'FBA-123' }), true);
  assert.equal(isFbaPackerLaneRow({ account_source: 'fba' }), true);
  assert.equal(isFbaPackerLaneRow({ tracking_type: 'fnsku' }), true);
  assert.equal(isFbaPackerLaneRow({ order_id: 'ORD-1', account_source: 'ebay', tracking_type: 'usps' }), false);
});

test('packer lane descriptors are the canonical 4 in order', () => {
  assert.deepEqual(PACKER_HISTORY_BOARD_LANES.map((l) => l.id), ['TODAY', 'THIS_WEEK', 'FBA', 'EXCEPTION']);
});

test('receiving incoming lanes bucket by delivery_state', () => {
  assert.equal(bucketReceivingIncomingLane({ delivery_state: 'DELIVERED_UNOPENED' }), 'DELIVERED_UNSCANNED');
  assert.equal(bucketReceivingIncomingLane({ delivery_state: 'TRACKING_UNAVAILABLE' }), 'TRACKING_UNAVAILABLE');
  assert.equal(bucketReceivingIncomingLane({ delivery_state: 'IN_TRANSIT' }), 'IN_TRANSIT');
  assert.equal(bucketReceivingIncomingLane({ delivery_state: 'ARRIVING_TODAY' }), 'IN_TRANSIT');
  assert.equal(bucketReceivingIncomingLane({ delivery_state: null, workflow_status: 'EXPECTED' }), 'EXPECTED');
  assert.deepEqual(RECEIVING_INCOMING_BOARD_LANES.map((l) => l.id), ['DELIVERED_UNSCANNED', 'IN_TRANSIT', 'EXPECTED', 'TRACKING_UNAVAILABLE']);
});

test('receiving history lanes: unfound > pending-unbox > recently-scanned > received', () => {
  const now = Date.UTC(2026, 6, 6, 18, 0, 0);
  assert.equal(bucketReceivingHistoryLane({ zoho_purchaseorder_id: null }, now), 'UNFOUND');
  assert.equal(bucketReceivingHistoryLane({ zoho_purchaseorder_id: 'PO-1', workflow_status: 'EXPECTED' }, now), 'PENDING_UNBOX');
  assert.equal(bucketReceivingHistoryLane({ zoho_purchaseorder_id: 'PO-1', workflow_status: 'RECEIVED', updated_at: new Date(now - 3_600_000).toISOString() }, now), 'RECENTLY_SCANNED');
  assert.equal(bucketReceivingHistoryLane({ zoho_purchaseorder_id: 'PO-1', workflow_status: 'RECEIVED', updated_at: new Date(now - 5 * 86_400_000).toISOString() }, now), 'RECEIVED');
  assert.deepEqual(RECEIVING_HISTORY_BOARD_LANES.map((l) => l.id), ['PENDING_UNBOX', 'RECENTLY_SCANNED', 'RECEIVED', 'UNFOUND']);
});

test('testing lanes bucket by qa_status verdict', () => {
  assert.equal(bucketTestingHistoryLane({ qa_status: 'PASSED' }), 'PASS');
  assert.equal(bucketTestingHistoryLane({ qa_status: 'FAILED' }), 'FAIL');
  assert.equal(bucketTestingHistoryLane({ qa_status: 'PENDING' }), 'RETEST');
  assert.equal(bucketTestingHistoryLane({ qa_status: null, needs_test: true }), 'RETEST');
  assert.deepEqual(TESTING_HISTORY_BOARD_LANES.map((l) => l.id), ['PASS', 'FAIL', 'RETEST']);
});
