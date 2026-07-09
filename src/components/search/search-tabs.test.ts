import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_TABS,
  isTabId,
  tabDbType,
  orderedTabsForScope,
  defaultTabForScope,
  groupHitsForPreview,
  flattenPreviewGroups,
} from './search-tabs';
import type { AiSearchHit } from '@/lib/search/ai-search-client';

function hit(entityType: string, id: number): AiSearchHit {
  return {
    id,
    entityType,
    title: `${entityType} ${id}`,
    subtitle: '',
    href: `/x/${id}`,
    matchField: 'keyword',
    score: 1,
  };
}

test('isTabId / tabDbType', () => {
  assert.equal(isTabId('order'), true);
  assert.equal(isTabId('nope'), false);
  assert.equal(tabDbType('order'), 'ORDER');
  assert.equal(tabDbType('unit'), 'SERIAL_UNIT');
  assert.equal(tabDbType('all'), undefined); // Overview has no db scope
});

test('orderedTabsForScope: global is Overview-first, operations is orders-first', () => {
  assert.equal(orderedTabsForScope('global')[0].id, 'all');
  const ops = orderedTabsForScope('operations');
  assert.equal(ops[0].id, 'order');
  assert.equal(ops[ops.length - 1].id, 'all'); // Overview demoted to last
  // same set, just reordered
  assert.equal(ops.length, CATEGORY_TABS.length);
});

test('defaultTabForScope', () => {
  assert.equal(defaultTabForScope('global'), 'all');
  assert.equal(defaultTabForScope('operations'), 'order');
});

test('groupHitsForPreview: orders first, per-group + total caps respected', () => {
  const hits = [
    hit('unit', 1),
    hit('order', 2),
    hit('order', 3),
    hit('order', 4),
    hit('unit', 5),
    hit('sku', 6),
  ];
  const groups = groupHitsForPreview(hits, { perGroup: 2, total: 8 });
  // Orders lead regardless of source order; each group capped at 2.
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Orders', 'Units', 'SKUs'],
  );
  assert.deepEqual(
    groups.map((g) => g.hits.length),
    [2, 2, 1],
  );
  // Flatten preserves the grouped display order (what keyboard nav walks).
  assert.deepEqual(
    flattenPreviewGroups(groups).map((h) => `${h.entityType}:${h.id}`),
    ['order:2', 'order:3', 'unit:1', 'unit:5', 'sku:6'],
  );
});

test('groupHitsForPreview: total cap drops trailing groups', () => {
  const hits = [hit('order', 1), hit('order', 2), hit('unit', 3), hit('sku', 4)];
  const groups = groupHitsForPreview(hits, { perGroup: 2, total: 3 });
  const flat = flattenPreviewGroups(groups);
  assert.equal(flat.length, 3); // 2 orders + 1 unit, sku dropped
  assert.deepEqual(
    flat.map((h) => h.entityType),
    ['order', 'order', 'unit'],
  );
});
