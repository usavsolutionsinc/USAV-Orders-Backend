import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describePhotoDatePath,
  isoWeekNumber,
  weekRange,
  weekRangeLabel,
} from '@/lib/photos/date-hierarchy';

// 2026-06-17 is the spec's worked example: ISO Week 25, Wed.
test('isoWeekNumber matches the calendar (2026-06-17 → 25)', () => {
  const dt = new Date(Date.UTC(2026, 5, 17));
  assert.equal(isoWeekNumber(dt), 25);
  const wk = weekRange(dt);
  assert.equal(wk.dateFrom, '2026-06-15'); // Monday
  assert.equal(wk.dateTo, '2026-06-21'); // Sunday
});

test('weekRangeLabel formats month day span', () => {
  assert.equal(weekRangeLabel('2026-06-15', '2026-06-21'), 'Jun 15-21');
  assert.equal(weekRangeLabel('2026-06-29', '2026-07-05'), 'Jun 29 - Jul 5');
});

test('a single day yields the full Year → Month → Week → Day path', () => {
  const crumbs = describePhotoDatePath({ dateFrom: '2026-06-17', dateTo: '2026-06-17' });
  assert.deepEqual(
    crumbs.map((c) => c.label),
    ['2026', 'June', 'Jun 15-21', 'June 17'],
  );
  // Only the leaf is current.
  assert.deepEqual(crumbs.map((c) => c.current), [false, false, false, true]);
  // Each crumb widens to its own span.
  assert.deepEqual(crumbs[0].range, { dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert.deepEqual(crumbs[1].range, { dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  assert.deepEqual(crumbs[2].range, { dateFrom: '2026-06-15', dateTo: '2026-06-21' });
  assert.deepEqual(crumbs[3].range, { dateFrom: '2026-06-17', dateTo: '2026-06-17' });
});

test('a week span stops at the Week crumb', () => {
  const crumbs = describePhotoDatePath({ dateFrom: '2026-06-15', dateTo: '2026-06-21' });
  assert.deepEqual(crumbs.map((c) => c.label), ['2026', 'June', 'Jun 15-21']);
  assert.equal(crumbs[crumbs.length - 1].current, true);
});

test('a full month span stops at the Month crumb', () => {
  const crumbs = describePhotoDatePath({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  assert.deepEqual(crumbs.map((c) => c.label), ['2026', 'June']);
});

test('a full year span is a single Year crumb', () => {
  const crumbs = describePhotoDatePath({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert.deepEqual(crumbs.map((c) => c.label), ['2026']);
  assert.equal(crumbs[0].current, true);
});

test('an arbitrary span collapses to one custom crumb', () => {
  const crumbs = describePhotoDatePath({ dateFrom: '2026-06-18', dateTo: '2026-06-24' });
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].key, 'custom');
  assert.equal(crumbs[0].label, 'June 18 – June 24');
});

test('no date selected → empty path (breadcrumb shows just its root)', () => {
  assert.deepEqual(describePhotoDatePath({}), []);
  assert.deepEqual(describePhotoDatePath({ dateTo: '2026-06-17' }), []);
});
