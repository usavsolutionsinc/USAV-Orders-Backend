import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  pushSearchRecent,
  listSearchRecents,
  removeSearchRecent,
  clearSearchRecents,
  migrateLegacyRecents,
  recentRerunHref,
  formatRelativeTime,
  groupRecentsByDay,
  SEARCH_RECENTS_MAX,
  SEARCH_RECENTS_MIGRATED_KEY,
  type SearchRecentEntry,
} from './search-recents';

// ─── Fake localStorage on globalThis (the module guards on `localStorage`) ───
function installFakeStore(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  return map;
}

beforeEach(() => {
  installFakeStore();
});

test('push then list returns the entry newest-first', () => {
  pushSearchRecent({ query: 'first', scope: 'global' });
  pushSearchRecent({ query: 'second', scope: 'global' });
  const list = listSearchRecents();
  assert.equal(list.length, 2);
  assert.equal(list[0].query, 'second');
  assert.equal(list[1].query, 'first');
  assert.ok(list[0].id && list[0].timestamp);
});

test('push dedupes case-insensitively within the same scope', () => {
  pushSearchRecent({ query: 'Samsung Galaxy', scope: 'global' });
  pushSearchRecent({ query: 'samsung galaxy', scope: 'global' });
  const list = listSearchRecents();
  assert.equal(list.length, 1);
  assert.equal(list[0].query, 'samsung galaxy'); // newest wins the dedupe
});

test('same query in different scopes are distinct entries', () => {
  pushSearchRecent({ query: 'x1d', scope: 'global' });
  pushSearchRecent({ query: 'x1d', scope: 'inventory:skus' });
  assert.equal(listSearchRecents().length, 2);
});

test('blank query is ignored', () => {
  assert.equal(pushSearchRecent({ query: '   ', scope: 'global' }), null);
  assert.equal(listSearchRecents().length, 0);
});

test('list is capped at SEARCH_RECENTS_MAX', () => {
  for (let i = 0; i < SEARCH_RECENTS_MAX + 12; i++) {
    pushSearchRecent({ query: `q${i}`, scope: 'global' });
  }
  assert.equal(listSearchRecents().length, SEARCH_RECENTS_MAX);
  assert.equal(listSearchRecents()[0].query, `q${SEARCH_RECENTS_MAX + 11}`);
});

test('listSearchRecents filters by scope and limit', () => {
  pushSearchRecent({ query: 'a', scope: 'global' });
  pushSearchRecent({ query: 'b', scope: 'inventory:skus' });
  pushSearchRecent({ query: 'c', scope: 'inventory:skus' });
  assert.equal(listSearchRecents({ scope: 'inventory:skus' }).length, 2);
  assert.equal(listSearchRecents({ limit: 1 }).length, 1);
});

test('removeSearchRecent drops one by id', () => {
  const a = pushSearchRecent({ query: 'a', scope: 'global' })!;
  pushSearchRecent({ query: 'b', scope: 'global' });
  removeSearchRecent(a.id);
  const list = listSearchRecents();
  assert.equal(list.length, 1);
  assert.equal(list[0].query, 'b');
});

test('clearSearchRecents(scope) only clears that scope; clearSearchRecents() clears all', () => {
  pushSearchRecent({ query: 'a', scope: 'global' });
  pushSearchRecent({ query: 'b', scope: 'inventory:skus' });
  clearSearchRecents('inventory:skus');
  assert.equal(listSearchRecents().length, 1);
  assert.equal(listSearchRecents()[0].scope, 'global');
  clearSearchRecents();
  assert.equal(listSearchRecents().length, 0);
});

test('recentRerunHref prefers explicit scopeHref, else /search?q=', () => {
  assert.equal(
    recentRerunHref({ query: 'a b', scopeHref: '/dashboard?unshipped&search=a%20b' }),
    '/dashboard?unshipped&search=a%20b',
  );
  assert.equal(recentRerunHref({ query: 'a b' }), '/search?q=a%20b');
});

// ─── Legacy migration ───────────────────────────────────────────────────────

test('migrateLegacyRecents seeds legacy buckets once, non-destructively', () => {
  const store = installFakeStore();
  store.set(
    'dashboard_search_history',
    JSON.stringify([{ query: 'PO-44102', timestamp: '2026-07-04T10:00:00.000Z' }]),
  );
  store.set(
    'inventory_search_history_skus',
    JSON.stringify([{ query: 'x1d', field: 'sku', timestamp: '2026-07-04T09:00:00.000Z', resultCount: 3 }]),
  );

  migrateLegacyRecents();
  const list = listSearchRecents();
  assert.equal(list.length, 2);

  const inv = list.find((e) => e.scope === 'inventory:skus')!;
  assert.equal(inv.query, 'x1d');
  assert.equal(inv.scopeLabel, 'Inventory · SKUs');
  assert.equal(inv.resultCount, 3);

  const dash = list.find((e) => e.scope === 'dashboard')!;
  assert.equal(dash.query, 'PO-44102');

  // Marker set; old keys retained (sidebars still read them).
  assert.equal(store.get(SEARCH_RECENTS_MIGRATED_KEY), '1');
  assert.ok(store.has('dashboard_search_history'));

  // Idempotent: a second run adds nothing.
  migrateLegacyRecents();
  assert.equal(listSearchRecents().length, 2);
});

test('migrateLegacyRecents ignores command-bar-recent (navigation, not queries)', () => {
  const store = installFakeStore();
  store.set('command-bar-recent', JSON.stringify([{ id: '1', label: 'Order #1', href: '/x' }]));
  migrateLegacyRecents();
  assert.equal(listSearchRecents().length, 0);
});

test('migrateLegacyRecents(deleteLegacy) removes old keys when asked', () => {
  const store = installFakeStore();
  store.set('shipped_search_history', JSON.stringify([{ query: 'fedex', timestamp: '2026-07-04T10:00:00.000Z' }]));
  migrateLegacyRecents({ deleteLegacy: true });
  assert.equal(listSearchRecents().length, 1);
  assert.equal(store.has('shipped_search_history'), false);
});

// ─── Pure presentation helpers ──────────────────────────────────────────────

test('formatRelativeTime buckets', () => {
  const now = Date.parse('2026-07-05T12:00:00.000Z');
  assert.equal(formatRelativeTime('2026-07-05T11:59:40.000Z', now), 'just now');
  assert.equal(formatRelativeTime('2026-07-05T11:55:00.000Z', now), '5m');
  assert.equal(formatRelativeTime('2026-07-05T09:00:00.000Z', now), '3h');
  assert.equal(formatRelativeTime('2026-07-03T12:00:00.000Z', now), '2d');
  assert.equal(formatRelativeTime('not-a-date', now), '');
});

test('groupRecentsByDay bands Today / Yesterday', () => {
  const now = Date.parse('2026-07-05T12:00:00.000Z');
  const entries: SearchRecentEntry[] = [
    { id: '1', query: 'a', scope: 'global', timestamp: '2026-07-05T08:00:00.000Z' },
    { id: '2', query: 'b', scope: 'global', timestamp: '2026-07-04T20:00:00.000Z' },
  ];
  const groups = groupRecentsByDay(entries, now);
  assert.equal(groups[0].label, 'Today');
  assert.equal(groups[0].entries.length, 1);
  assert.equal(groups[1].label, 'Yesterday');
});
