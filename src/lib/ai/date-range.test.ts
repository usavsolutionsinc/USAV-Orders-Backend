import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAiTimeframe } from '@/lib/ai/date-range';

test('resolveAiTimeframe returns last week using PST Mon-Fri range', () => {
  const timeframe = resolveAiTimeframe('How many orders were shipped last week and by who?', '2026-03-26');

  assert.equal(timeframe.kind, 'last_week');
  assert.equal(timeframe.start, '2026-03-16');
  assert.equal(timeframe.end, '2026-03-20');
  assert.equal(timeframe.explicit, true);
});

test('resolveAiTimeframe defaults to current week when no range is specified', () => {
  const timeframe = resolveAiTimeframe('How many shipped orders do we have by tester?', '2026-03-26');

  assert.equal(timeframe.kind, 'this_week');
  assert.equal(timeframe.start, '2026-03-23');
  assert.equal(timeframe.end, '2026-03-27');
  assert.equal(timeframe.explicit, false);
});

test('resolveAiTimeframe supports single-day today and yesterday ranges', () => {
  const today = resolveAiTimeframe('What shipped today?', '2026-03-26');
  const yesterday = resolveAiTimeframe('What shipped yesterday?', '2026-03-26');

  assert.equal(today.start, '2026-03-26');
  assert.equal(today.end, '2026-03-26');
  assert.equal(yesterday.start, '2026-03-25');
  assert.equal(yesterday.end, '2026-03-25');
});
