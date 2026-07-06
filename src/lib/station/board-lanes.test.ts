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
