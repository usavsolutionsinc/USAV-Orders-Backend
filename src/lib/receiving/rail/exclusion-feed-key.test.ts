/**
 * Pure tests for the rail → feed_key / exclusion → rail-id mapping.
 * Run: npx tsx --test src/lib/receiving/rail/exclusion-feed-key.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { railExclusionFeedKey, exclusionToRailId } from './exclusion-feed-key';

test('railExclusionFeedKey: triage feeds → receiving_triage', () => {
  assert.equal(railExclusionFeedKey('triageCombined'), 'receiving_triage');
  assert.equal(railExclusionFeedKey('triageUnfound'), 'receiving_triage');
  assert.equal(railExclusionFeedKey('triageDone'), 'receiving_triage');
});

test('railExclusionFeedKey: unbox feeds → receiving_unbox', () => {
  assert.equal(railExclusionFeedKey('unboxRecent'), 'receiving_unbox');
  assert.equal(railExclusionFeedKey('unboxQueue'), 'receiving_unbox');
  assert.equal(railExclusionFeedKey('viewed'), 'receiving_unbox');
});

test('railExclusionFeedKey: the shared Scanned feed splits by scope', () => {
  assert.equal(railExclusionFeedKey('scanned', 'triage'), 'receiving_triage');
  assert.equal(railExclusionFeedKey('scanned', 'unbox'), 'receiving_unbox');
  assert.equal(railExclusionFeedKey('scanned'), 'receiving_unbox'); // default (Queue)
});

test('exclusionToRailId: carton negates, line stays positive (matches getRowId = row.id)', () => {
  assert.equal(exclusionToRailId('RECEIVING', 88), -88); // unfound carton stub id < 0
  assert.equal(exclusionToRailId('RECEIVING_LINE', 41), 41); // real line id > 0
});
