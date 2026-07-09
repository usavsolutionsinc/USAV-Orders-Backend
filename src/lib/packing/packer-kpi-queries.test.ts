import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIER_MINUTES } from './pack-tier-classifier';

function minutesForTier(tier: 'SMALL' | 'MEDIUM' | 'LARGE'): number {
  if (tier === 'SMALL') return DEFAULT_TIER_MINUTES.SMALL;
  if (tier === 'LARGE') return DEFAULT_TIER_MINUTES.LARGE;
  return DEFAULT_TIER_MINUTES.MEDIUM;
}

test('tier minutes defaults match capacity assumptions', () => {
  assert.equal(minutesForTier('SMALL'), 5);
  assert.equal(minutesForTier('MEDIUM'), 13);
  assert.equal(minutesForTier('LARGE'), 45);
});

test('packerKpiSummaryToCsvRows formats per-packer table', async () => {
  const { packerKpiSummaryToCsvRows } = await import('./packer-kpi-queries');
  const rows = packerKpiSummaryToCsvRows({
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
      medium_count: 18,
      large_count: 4,
      weighted_minutes: 312,
      remaining_minutes: 648,
    },
    by_packer: [
      {
        staff_id: 4,
        staff_name: 'Alice',
        small_count: 2,
        medium_count: 18,
        large_count: 4,
        weighted_minutes: 312,
      },
    ],
    fba: {
      pending_units: 0,
      pending_weighted_minutes: 0,
      avg_minutes_per_unit: null,
      fillable_units: 0,
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].packer, 'Alice');
  assert.equal(rows[0].small, 2);
  assert.equal(rows[0].medium, 18);
  assert.equal(rows[0].large, 4);
  assert.equal(rows[0].weightedMin, 312);
  assert.equal(rows[0].percentOfDay, '65.0%');
});

