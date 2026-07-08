/**
 * DB-free unit tests for hybridSearch — Deps fakes, no pool, no network.
 * Run: npx tsx --test src/lib/search/hybrid-retrieval.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  hybridSearch,
  looksLikeIdentifier,
  rrfMerge,
  type DocHitRow,
  type HybridSearchDeps,
} from './hybrid-retrieval';
import type { GlobalSearchResult } from './global-entity-search';
import type { SearchEntityType } from './build-search-text';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

const doc = (entityType: SearchEntityType, id: number, title = `T${id}`): DocHitRow => ({
  entity_type: entityType,
  entity_id: id,
  title,
  subtitle: null,
  status: 'ACTIVE',
  condition_grade: null,
  source_platform: 'ebay',
  tracking_number: null,
  carrier: null,
  happened_at: null,
});

const exactHit = (id: number): GlobalSearchResult => ({
  id,
  entityType: 'order',
  title: `Order ${id}`,
  subtitle: 'sub',
  href: `/dashboard?openOrderId=${id}`,
  matchField: 'order',
});

interface Captured {
  exactCalls: string[];
  keywordCalls: Array<{ query: string; entityTypes?: SearchEntityType[] }>;
  embedCalls: string[];
  vectorCalls: number;
}

function fakes(opts: {
  exact?: GlobalSearchResult[];
  keyword?: DocHitRow[];
  vector?: DocHitRow[];
  embedFails?: boolean;
} = {}) {
  const cap: Captured = { exactCalls: [], keywordCalls: [], embedCalls: [], vectorCalls: 0 };
  const deps: HybridSearchDeps = {
    exactSearch: async (_orgId, query) => {
      cap.exactCalls.push(query);
      return opts.exact ?? [];
    },
    keywordSearch: async (_orgId, query, entityTypes) => {
      cap.keywordCalls.push({ query, entityTypes });
      return opts.keyword ?? [];
    },
    embedQuery: async (_orgId, query) => {
      cap.embedCalls.push(query);
      if (opts.embedFails) return null;
      return new Array(768).fill(0.2);
    },
    vectorSearch: async () => {
      cap.vectorCalls += 1;
      return opts.vector ?? [];
    },
  };
  return { deps, cap };
}

// ── looksLikeIdentifier ─────────────────────────────────────────────────────

test('identifier heuristic: serials/tracking/ids yes, natural language no', () => {
  for (const id of ['1Z999AA10123456784', '12-34567-89012', 'SN12345', '4821', 'RS-105', 'X0012ABCDE']) {
    assert.equal(looksLikeIdentifier(id), true, `${id} should look like an identifier`);
  }
  for (const nl of ['samsung phones in fair condition', 'bose speaker', 'ebay returns june', '', '  ']) {
    assert.equal(looksLikeIdentifier(nl), false, `"${nl}" should NOT look like an identifier`);
  }
});

// ── exact bypass ────────────────────────────────────────────────────────────

test('exact hit ranks first but does NOT short-circuit keyword (no embed/vector)', async () => {
  const { deps, cap } = fakes({ exact: [exactHit(42)] });
  const res = await hybridSearch(ORG, '1Z999AA10123456784', {}, deps);

  assert.equal(res.hits[0].id, 42);
  assert.equal(res.hits[0].score, 1000); // exact pinned above any fuzzy score
  assert.equal(res.usedSemantic, false);
  assert.deepEqual(cap.exactCalls, ['1Z999AA10123456784']);
  // Keyword arm STILL runs in parallel (so serial units can surface) — but the
  // embed/vector arms are skipped for identifier queries (latency win).
  assert.equal(cap.keywordCalls.length, 1);
  assert.equal(cap.embedCalls.length, 0);
  assert.equal(cap.vectorCalls, 0);
});

test('identifier query merges the serial-unit keyword hit under the exact hit', async () => {
  // The regression this fixes: a unit serial like "3476" matched an unrelated
  // order/tracking substring in the exact arm and the serial unit vanished.
  // The exact arm has no serial-unit searcher, so the unit must arrive via
  // keyword and be merged in — not short-circuited away.
  const { deps, cap } = fakes({
    exact: [exactHit(42)], // an order the parent searcher found
    keyword: [doc('SERIAL_UNIT', 1840, '3476')],
  });
  const res = await hybridSearch(ORG, '3476', {}, deps);

  assert.equal(cap.exactCalls.length, 1);
  assert.equal(cap.keywordCalls.length, 1);
  // Exact hit first, the serial unit merged in second.
  assert.equal(res.hits[0].id, 42);
  const unit = res.hits.find((h) => h.entityType === 'unit');
  assert.ok(unit, 'the serial unit must surface alongside the exact hit');
  assert.equal(unit?.id, 1840);
});

test('exact + keyword merge de-dupes an entity present in both arms', async () => {
  const { deps } = fakes({
    exact: [exactHit(7)], // entityType 'order' id 7
    keyword: [doc('ORDER', 7), doc('SERIAL_UNIT', 9)],
  });
  const res = await hybridSearch(ORG, '7', {}, deps);
  // Order 7 appears once (exact wins), the unit is additive.
  assert.equal(res.hits.filter((h) => h.entityType === 'order' && h.id === 7).length, 1);
  assert.ok(res.hits.some((h) => h.entityType === 'unit' && h.id === 9));
});

test('identifier query with NO exact hits falls through to hybrid arms', async () => {
  const { deps, cap } = fakes({ exact: [], keyword: [doc('SKU', 1)] });
  const res = await hybridSearch(ORG, 'SN99999', {}, deps);

  assert.equal(cap.exactCalls.length, 1);
  assert.equal(cap.keywordCalls.length, 1);
  assert.equal(res.hits.length, 1);
});

test('natural-language query never calls the exact arm', async () => {
  const { deps, cap } = fakes({ keyword: [doc('SKU', 1)] });
  await hybridSearch(ORG, 'samsung fair condition', {}, deps);
  assert.equal(cap.exactCalls.length, 0);
});

test('hard entityTypes scope skips the exact bypass (it cannot honor the scope)', async () => {
  // searchUnits('12345') must return unit hits from the docs arms — never
  // Order/Repair/FBA #12345 from the parent-table fan-out.
  const { deps, cap } = fakes({
    exact: [exactHit(12345)],
    keyword: [doc('SERIAL_UNIT', 7)],
  });
  const res = await hybridSearch(ORG, '12345', { entityTypes: ['SERIAL_UNIT'] }, deps);

  assert.equal(cap.exactCalls.length, 0); // bypass skipped
  assert.equal(cap.keywordCalls.length, 1);
  assert.deepEqual(cap.keywordCalls[0].entityTypes, ['SERIAL_UNIT']);
  assert.equal(res.hits[0]?.entityType, 'unit');
});

// ── degradation ─────────────────────────────────────────────────────────────

test('embed failure degrades to keyword-only: results still return, usedSemantic=false', async () => {
  const { deps, cap } = fakes({ keyword: [doc('ORDER', 5), doc('SKU', 6)], embedFails: true });
  const res = await hybridSearch(ORG, 'bose revolve speaker', {}, deps);

  assert.equal(res.hits.length, 2);
  assert.equal(res.usedSemantic, false);
  assert.equal(cap.vectorCalls, 0); // no vector query without an embedding
  for (const hit of res.hits) assert.equal(hit.matchField, 'keyword');
});

test('semantic-only hits are labeled and usedSemantic=true', async () => {
  const { deps } = fakes({ keyword: [], vector: [doc('SERIAL_UNIT', 9)] });
  const res = await hybridSearch(ORG, 'noise cancelling headphones', {}, deps);

  assert.equal(res.usedSemantic, true);
  assert.equal(res.hits.length, 1);
  assert.equal(res.hits[0].matchField, 'semantic');
  assert.equal(res.hits[0].entityType, 'unit'); // DB→UI vocabulary mapping
  assert.equal(res.hits[0].href, '/inventory/units?unit=9');
});

// ── RRF merge ───────────────────────────────────────────────────────────────

test('rrfMerge: doc in both arms outranks single-arm docs', () => {
  const both = doc('ORDER', 1);
  const kwOnly = doc('SKU', 2);
  const vecOnly = doc('REPAIR', 3);
  const merged = rrfMerge([[kwOnly, both], [both, vecOnly]], 10);

  assert.equal(merged[0].row.entity_id, 1);
  assert.equal(merged[0].arms, 2);
});

test('rrfMerge is deterministic: ties break on (entityType, entityId)', () => {
  const a = doc('ORDER', 2);
  const b = doc('ORDER', 1);
  const run1 = rrfMerge([[a], [b]], 10).map((m) => m.row.entity_id);
  const run2 = rrfMerge([[a], [b]], 10).map((m) => m.row.entity_id);
  // Same rank in different arms → identical score → id ascending, stable.
  assert.deepEqual(run1, [1, 2]);
  assert.deepEqual(run1, run2);
});

test('rrfMerge respects limit', () => {
  const rows = Array.from({ length: 30 }, (_, i) => doc('SKU', i + 1));
  assert.equal(rrfMerge([rows], 5).length, 5);
});

test('rrfMerge boost: page-context types reorder near-ties without excluding others', () => {
  const order = doc('ORDER', 1);
  const receiving = doc('RECEIVING', 2);
  // Same rank in parallel arms → identical base score; boost breaks the tie.
  const merged = rrfMerge([[order], [receiving]], 10, ['RECEIVING']);
  assert.equal(merged[0].row.entity_type, 'RECEIVING');
  assert.equal(merged.length, 2); // nothing filtered out
  // A strong non-boosted hit still outranks a weak boosted one (1.3× cap).
  const strongOrder = doc('ORDER', 3);
  const weakReceiving = doc('RECEIVING', 4);
  const merged2 = rrfMerge(
    [[strongOrder, weakReceiving], [strongOrder]], // ORDER in both arms, rank 0
    10,
    ['RECEIVING'],
  );
  assert.equal(merged2[0].row.entity_type, 'ORDER');
});

test('boostEntityTypes threads through hybridSearch into the merge', async () => {
  const { deps } = fakes({
    keyword: [doc('ORDER', 1), doc('RECEIVING', 2)],
  });
  const res = await hybridSearch(
    ORG,
    'bose speaker',
    { boostEntityTypes: ['RECEIVING'] },
    deps,
  );
  assert.equal(res.hits[0].entityType, 'receiving'); // boosted past the equal-rank...
});

// ── mapping + options ───────────────────────────────────────────────────────

test('hits map facets to chips and carry machine-readable facets', async () => {
  const row = doc('RECEIVING', 7);
  row.condition_grade = 'USED_GOOD';
  row.tracking_number = '9400111899561234567890';
  row.carrier = 'USPS';
  const { deps } = fakes({ keyword: [row] });
  const res = await hybridSearch(ORG, 'ebay carton', {}, deps);

  const hit = res.hits[0];
  assert.equal(hit.entityType, 'receiving');
  assert.equal(hit.href, '/unbox?openReceivingId=7');
  assert.deepEqual(hit.chips.map((c) => c.label).sort(), ['ACTIVE', 'USED_GOOD', 'ebay'].sort());
  assert.equal(hit.facets?.condition_grade, 'USED_GOOD');
  // Phase E: tracking/carrier pass through to the machine-readable facets so
  // the row can render the carrier + last-4 tracking chip (CopyChip SoT).
  assert.equal(hit.facets?.tracking_number, '9400111899561234567890');
  assert.equal(hit.facets?.carrier, 'USPS');
});

test('entityTypes option is threaded into the keyword arm', async () => {
  const { deps, cap } = fakes({ keyword: [] });
  await hybridSearch(ORG, 'bose speaker', { entityTypes: ['SKU', 'SERIAL_UNIT'] }, deps);
  assert.deepEqual(cap.keywordCalls[0].entityTypes, ['SKU', 'SERIAL_UNIT']);
});

test('blank query is a no-op', async () => {
  const { deps, cap } = fakes();
  const res = await hybridSearch(ORG, '   ', {}, deps);
  assert.deepEqual(res, { hits: [], usedSemantic: false });
  assert.equal(cap.keywordCalls.length + cap.exactCalls.length + cap.embedCalls.length, 0);
});
