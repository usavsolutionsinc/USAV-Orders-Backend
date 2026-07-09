import test from 'node:test';
import assert from 'node:assert/strict';
import { platformPriorityRank, priorityRankSql } from './precedence';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

test('platformPriorityRank reproduces the legacy client ranks exactly', () => {
  // flagged wins outright
  assert.equal(platformPriorityRank(false, 'amazon', true), 0);
  // unmatched / empty platform
  assert.equal(platformPriorityRank(true, 'amazon', false), 1);
  assert.equal(platformPriorityRank(false, '', false), 1);
  assert.equal(platformPriorityRank(false, null, false), 1);
  // platform ranks (case-insensitive)
  assert.equal(platformPriorityRank(false, 'amazon', false), 2);
  assert.equal(platformPriorityRank(false, 'EBAY', false), 3);
  assert.equal(platformPriorityRank(false, 'Goodwill', false), 4);
  // anything else
  assert.equal(platformPriorityRank(false, 'walmart', false), 9);
});

test('priorityRankSql equals the original hand-written fragment (whitespace-insensitive)', () => {
  const ORIGINAL = `
  COALESCE(r.priority_tier, CASE
    WHEN COALESCE(r.is_priority, false) THEN 0
    WHEN r.source = 'unmatched' OR r.source_platform IS NULL THEN 1
    WHEN lower(r.source_platform) = 'amazon'   THEN 2
    WHEN lower(r.source_platform) = 'ebay'     THEN 3
    WHEN lower(r.source_platform) = 'goodwill' THEN 4
    ELSE 9
  END)`;
  const generated = priorityRankSql({
    tier: 'r.priority_tier',
    isPriority: 'r.is_priority',
    source: 'r.source',
    sourcePlatform: 'r.source_platform',
  });
  assert.equal(norm(generated), norm(ORIGINAL));
});

test('priorityRankSql respects custom column aliases', () => {
  const sql = priorityRankSql({
    tier: 'l.priority_tier',
    isPriority: 'l.is_priority',
    source: 'l.source',
    sourcePlatform: 'l.source_platform',
  });
  assert.match(sql, /COALESCE\(l\.priority_tier, CASE/);
  assert.match(sql, /lower\(l\.source_platform\) = 'amazon' THEN 2/);
});
