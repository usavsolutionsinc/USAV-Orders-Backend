import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packerKpiSummaryToTextDocument,
  packerKpiSummaryToRtf,
  packerKpiPeriodToTextDocument,
} from './packing-report-document';
import type { PackingKpiPeriodSummary, PackingKpiSummary } from './packer-kpi-queries';

const SAMPLE: PackingKpiSummary = {
  day: '2026-07-08',
  capacity: {
    packer_headcount: 2,
    workday_minutes: 480,
    daily_capacity_minutes: 960,
    daily_medium_target: 60,
    daily_large_target: 16,
  },
  totals: {
    small_count: 2,
    medium_count: 37,
    large_count: 2,
    total_boxes_packed: 41,
    weighted_minutes: 581,
    remaining_minutes: 379,
  },
  by_packer: [
    {
      staff_id: 4,
      staff_name: 'Thuy',
      small_count: 2,
      medium_count: 28,
      large_count: 1,
      weighted_minutes: 419,
    },
    {
      staff_id: 5,
      staff_name: 'Tuan',
      small_count: 0,
      medium_count: 9,
      large_count: 1,
      weighted_minutes: 162,
    },
  ],
  fba: {
    pending_units: 0,
    pending_weighted_minutes: 0,
    avg_minutes_per_unit: null,
    fillable_units: 0,
  },
};

test('text document puts table before friendly notes', () => {
  const doc = packerKpiSummaryToTextDocument(SAMPLE);
  const tableIdx = doc.indexOf('Thuy');
  const notesIdx = doc.indexOf('Notes');
  assert.ok(tableIdx >= 0);
  assert.ok(notesIdx > tableIdx);
  assert.match(doc, /Pack minutes \(weighted\)/);
  assert.match(doc, /Total boxes packed: 41/);
  assert.match(doc, /Team total/);
  assert.match(doc, /Wednesday, July 8, 2026/);
});

test('rtf document includes table rows and notes', () => {
  const doc = packerKpiSummaryToRtf(SAMPLE);
  assert.match(doc, /\\rtf1/);
  assert.match(doc, /Thuy/);
  assert.match(doc, /Notes/);
  assert.match(doc, /\\trowd/);
});

const PERIOD_SAMPLE: PackingKpiPeriodSummary = {
  start_day: '2026-07-07',
  end_day: '2026-07-08',
  day_count: 2,
  filled_day_count: 2,
  capacity: SAMPLE.capacity,
  daily: [
    { ...SAMPLE, day: '2026-07-07', totals: { ...SAMPLE.totals, total_boxes_packed: 30, weighted_minutes: 400 } },
    SAMPLE,
  ],
  totals: {
    small_count: 4,
    medium_count: 74,
    large_count: 4,
    total_boxes_packed: 71,
    weighted_minutes: 981,
    remaining_minutes: 0,
  },
  by_packer: SAMPLE.by_packer,
};

test('period document uses weekday labels and omits zero-day note for filled days only', () => {
  const doc = packerKpiPeriodToTextDocument(PERIOD_SAMPLE);
  assert.match(doc, /2 pack days/);
  assert.match(doc, /Tue, Jul 7/);
  assert.match(doc, /Wed, Jul 8/);
  assert.doesNotMatch(doc, /2026-07-03/);
  assert.match(doc, /days with activity only/);
});
