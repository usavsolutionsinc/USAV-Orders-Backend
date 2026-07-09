/**
 * DB-free unit tests for the SearchHit SoT mappings (vocab, deep-links,
 * scope-filter hrefs).
 * Run: npx tsx --test src/lib/search/search-hit.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  facetChips,
  isUiEntityType,
  searchHitHref,
  searchScopeHref,
  searchScopeLabel,
  toDbEntityType,
  toUiEntityType,
} from './search-hit';
import { SEARCH_ENTITY_TYPES } from './build-search-text';

test('DB↔UI vocabulary round-trips for every discriminator value', () => {
  for (const dbType of SEARCH_ENTITY_TYPES) {
    const ui = toUiEntityType(dbType);
    assert.equal(isUiEntityType(ui), true);
    assert.equal(toDbEntityType(ui), dbType);
  }
});

test('searchHitHref: every entity type deep-links to its record surface', () => {
  assert.equal(searchHitHref('ORDER', 42), '/o/42');
  assert.equal(searchHitHref('SERIAL_UNIT', 9), '/inventory/units?unit=9');
  assert.equal(searchHitHref('RECEIVING', 3), '/unbox?openReceivingId=3');
  assert.equal(searchHitHref('SKU', 11), '/products?view=qc&skuId=11');
  assert.equal(searchHitHref('REPAIR', 5), '/repair?tab=active&openRepair=5');
  assert.equal(searchHitHref('FBA_SHIPMENT', 2), '/fba?openShipmentId=2');
});

test('searchScopeHref: URL-searchable surfaces get the query applied; others null', () => {
  assert.equal(searchScopeHref('ORDER', 'bose revolve'), '/dashboard?search=bose%20revolve');
  assert.equal(searchScopeHref('SERIAL_UNIT', 'samsung'), '/inventory/units?q=samsung');
  assert.equal(searchScopeHref('SKU', 'wave radio'), '/inventory/skus?q=wave%20radio');
  assert.equal(searchScopeHref('RECEIVING', 'x'), null);
  assert.equal(searchScopeHref('REPAIR', 'x'), null);
  assert.equal(searchScopeHref('FBA_SHIPMENT', 'x'), null);
  assert.equal(searchScopeHref('ORDER', '   '), null); // blank query → no dead link
});

test('searchScopeLabel pairs exactly with searchScopeHref availability', () => {
  for (const dbType of SEARCH_ENTITY_TYPES) {
    const href = searchScopeHref(dbType, 'q');
    const label = searchScopeLabel(dbType);
    assert.equal(href === null, label === null, `${dbType}: href/label must agree`);
  }
});

test('facetChips: one chip per present facet, tones from the semantic families', () => {
  const chips = facetChips({ status: 'TESTED', conditionGrade: 'USED_GOOD', sourcePlatform: 'ebay' });
  assert.deepEqual(
    chips.map((c) => `${c.label}:${c.tone}`),
    ['TESTED:blue', 'USED_GOOD:amber', 'ebay:gray'],
  );
  assert.deepEqual(facetChips({}), []);
});
