import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSearchScopeLabel } from './search-scope-labels';

test('global resolves to Everywhere', () => {
  assert.equal(resolveSearchScopeLabel('global'), 'Everywhere');
  assert.equal(resolveSearchScopeLabel(''), 'Everywhere');
});

test('top-level surfaces resolve to curated labels', () => {
  assert.equal(resolveSearchScopeLabel('dashboard'), 'Dashboard');
  assert.equal(resolveSearchScopeLabel('shipped'), 'Shipped');
  assert.equal(resolveSearchScopeLabel('inventory'), 'Inventory');
});

test('inventory sub-tabs resolve to "Inventory · <Tab>"', () => {
  assert.equal(resolveSearchScopeLabel('inventory:skus'), 'Inventory · SKUs');
  assert.equal(resolveSearchScopeLabel('inventory:bins'), 'Inventory · Bins');
  assert.equal(resolveSearchScopeLabel('inventory:units'), 'Inventory · Units');
});

test('dashboard sub-modes return the specific view label', () => {
  assert.equal(resolveSearchScopeLabel('dashboard:unshipped'), 'Unshipped');
  assert.equal(resolveSearchScopeLabel('dashboard:pending'), 'Pending');
});

test('unknown surface degrades to a title-cased label', () => {
  assert.equal(resolveSearchScopeLabel('scouting'), 'Scouting');
  assert.equal(resolveSearchScopeLabel('some_new_area'), 'Some New Area');
});

test('unknown sub degrades to "Surface · TitleCasedSub"', () => {
  assert.equal(resolveSearchScopeLabel('receiving:incoming'), 'Receiving · Incoming');
  assert.equal(resolveSearchScopeLabel('operations:live_feed'), 'Operations · Live Feed');
});
