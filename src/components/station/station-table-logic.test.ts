import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDetailsReopen,
  resolveDetailsNavigation,
  sumDaySectionCounts,
} from './station-table-logic';

// ─── isDetailsReopen ──────────────────────────────────────────────────────────

test('isDetailsReopen: true only when the clicked row is the open one', () => {
  assert.equal(isDetailsReopen(5, 5), true);
  assert.equal(isDetailsReopen(5, 6), false);
});

test('isDetailsReopen: never reopens when nothing is selected', () => {
  assert.equal(isDetailsReopen(null, 5), false);
  // id 0 is a valid detail id and must not be treated as "no selection".
  assert.equal(isDetailsReopen(0, 0), true);
});

// ─── resolveDetailsNavigation ─────────────────────────────────────────────────

type Row = { id: number };
const getId = (r: Row) => r.id;
const rows: Row[] = [{ id: 10 }, { id: 20 }, { id: 30 }];

test('resolveDetailsNavigation: steps down to the next record', () => {
  assert.deepEqual(resolveDetailsNavigation(rows, 20, 'down', getId), { id: 30 });
});

test('resolveDetailsNavigation: steps up to the previous record', () => {
  assert.deepEqual(resolveDetailsNavigation(rows, 20, 'up', getId), { id: 10 });
});

test('resolveDetailsNavigation: defaults to "down" when direction is undefined', () => {
  assert.deepEqual(resolveDetailsNavigation(rows, 10, undefined, getId), { id: 20 });
});

test('resolveDetailsNavigation: returns null when stepping past either end', () => {
  assert.equal(resolveDetailsNavigation(rows, 30, 'down', getId), null);
  assert.equal(resolveDetailsNavigation(rows, 10, 'up', getId), null);
});

test('resolveDetailsNavigation: returns null when there is no selection or list is empty', () => {
  assert.equal(resolveDetailsNavigation(rows, null, 'down', getId), null);
  assert.equal(resolveDetailsNavigation([], 10, 'down', getId), null);
});

test('resolveDetailsNavigation: returns null when the selection is not in the list', () => {
  assert.equal(resolveDetailsNavigation(rows, 999, 'down', getId), null);
});

// ─── sumDaySectionCounts ──────────────────────────────────────────────────────

test('sumDaySectionCounts: totals records across all day sections', () => {
  const sections: [string, Row[]][] = [
    ['2026-06-20', [{ id: 1 }, { id: 2 }]],
    ['2026-06-19', [{ id: 3 }]],
  ];
  assert.equal(sumDaySectionCounts(sections), 3);
});

test('sumDaySectionCounts: zero for no sections', () => {
  assert.equal(sumDaySectionCounts<Row>([]), 0);
});
