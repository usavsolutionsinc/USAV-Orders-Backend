import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  clampLimit,
  encodeCursor,
  decodeCursor,
  mapStationsToSpines,
  resolveSources,
  buildBrowseQuery,
  windowBounds,
  JOURNEY_SOURCES,
  type JourneyCursor,
} from './journey-helpers';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

test('clampLimit: default, floor, ceiling', () => {
  assert.equal(clampLimit(null), 60);
  assert.equal(clampLimit(undefined), 60);
  assert.equal(clampLimit(Number.NaN), 60);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(999), 200);
  assert.equal(clampLimit(50.9), 50);
});

test('cursor codec: round-trips and rejects junk', () => {
  const c: JourneyCursor = { at: '2026-06-20T18:03:00.000Z', source: 'sal', id: 8841 };
  const round = decodeCursor(encodeCursor(c));
  assert.deepEqual(round, c);

  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(''), null);
  assert.equal(decodeCursor('not-base64-$$$'), null);
  // Valid base64 but wrong shape → null.
  assert.equal(decodeCursor(Buffer.from('{"at":"x"}', 'utf8').toString('base64url')), null);
});

test('mapStationsToSpines: per-spine vocab translation', () => {
  assert.deepEqual(mapStationsToSpines(['SHIP']), { sal: ['OUTBOUND'], inv: ['SHIP'] });
  assert.deepEqual(mapStationsToSpines(['OUTBOUND']), { sal: ['OUTBOUND'], inv: ['SHIP'] });
  assert.deepEqual(mapStationsToSpines(['FBA']), { sal: ['FBA'], inv: [] });
  assert.deepEqual(mapStationsToSpines(['RECEIVING']), { sal: ['RECEIVING'], inv: ['RECEIVING'] });
  // Unknown stations are ignored, not passed through.
  assert.deepEqual(mapStationsToSpines(['BOGUS']), { sal: [], inv: [] });
  const both = mapStationsToSpines(['TECH', 'PACK']);
  assert.deepEqual(both.sal.sort(), ['PACK', 'TECH']);
  assert.deepEqual(both.inv.sort(), ['PACK', 'TECH']);
});

test('resolveSources: default all, sources filter, station/type narrowing', () => {
  assert.deepEqual(resolveSources({}), [...JOURNEY_SOURCES]);
  assert.deepEqual(resolveSources({ sources: ['sal', 'carrier'] }), ['sal', 'carrier']);
  // A station filter restricts to the station-bearing spines.
  assert.deepEqual(resolveSources({ stations: ['TECH'] }), ['sal', 'inventory']);
  // A type filter keeps the type-bearing spines (incl. audit).
  assert.deepEqual(resolveSources({ types: ['TEST_PASS'] }), ['sal', 'inventory', 'audit']);
  // carrier+warranty get pruned entirely under a station filter.
  assert.deepEqual(resolveSources({ sources: ['carrier', 'warranty'], stations: ['TECH'] }), []);
});

test('buildBrowseQuery: includes every active spine + keyset, org param first', () => {
  const { sql, params, limit } = buildBrowseQuery(ORG, {}, null);
  for (const marker of ["'sal'::text", "'inventory'::text", "'audit'::text", "'carrier'::text", "'warranty'::text"]) {
    assert.ok(sql.includes(marker), `expected browse SQL to include ${marker}`);
  }
  assert.equal(params[0], ORG, 'org id is the first bound param');
  assert.ok(sql.includes('UNION ALL'), 'spines are UNION ALL-ed');
  assert.ok(sql.includes('(u.at, u.source, u.id_num) <'), 'keyset predicate present');
  assert.equal(limit, 60);
  // LIMIT binds limit+1 to detect "has more".
  assert.equal(params[params.length - 1], 61);
});

test('buildBrowseQuery: source pruning omits inactive branches', () => {
  const { sql } = buildBrowseQuery(ORG, { sources: ['sal'] }, null);
  assert.ok(sql.includes("'sal'::text"));
  assert.ok(!sql.includes("'carrier'::text"), 'carrier branch pruned');
  assert.ok(!sql.includes("'warranty'::text"), 'warranty branch pruned');

  const stationScoped = buildBrowseQuery(ORG, { stations: ['TECH'] }, null);
  assert.ok(!stationScoped.sql.includes("'carrier'::text"), 'station filter prunes carrier');
  assert.ok(!stationScoped.sql.includes("'audit'::text"), 'station filter prunes audit');
  assert.ok(stationScoped.sql.includes("'inventory'::text"));
});

test('buildBrowseQuery: all-pruned yields a defensive empty query', () => {
  const { sql, params } = buildBrowseQuery(ORG, { sources: ['carrier'], stations: ['TECH'] }, null);
  assert.match(sql, /WHERE false/);
  assert.deepEqual(params, []);
});

test('buildBrowseQuery: a cursor binds at/source/id (not null)', () => {
  const cursor: JourneyCursor = { at: '2026-06-20T00:00:00.000Z', source: 'inventory', id: 42 };
  const { params } = buildBrowseQuery(ORG, {}, cursor);
  assert.ok(params.includes(cursor.at));
  assert.ok(params.includes(cursor.source));
  assert.ok(params.includes(cursor.id));
});

test('windowBounds: invalid dates fall back instead of throwing', () => {
  const { from, to } = windowBounds({ from: 'garbage', to: 'also-bad' }, 1000);
  assert.ok(!Number.isNaN(new Date(from).getTime()), 'from is a valid date');
  assert.ok(!Number.isNaN(new Date(to).getTime()), 'to is a valid date');
  assert.ok(new Date(from).getTime() < new Date(to).getTime(), 'from precedes to');
});

test('buildBrowseQuery: q LIKE wildcards are escaped + length-capped', () => {
  const { params } = buildBrowseQuery(ORG, { q: '50%_x' }, null);
  // % and _ are escaped with a backslash so they match literally, not as wildcards.
  assert.ok(
    params.some((v) => typeof v === 'string' && v.includes('50\\%\\_x')),
    'escaped LIKE pattern is bound',
  );
  // Over-long q is truncated to 100 chars (+2 for the surrounding %).
  const long = buildBrowseQuery(ORG, { q: 'a'.repeat(500) }, null);
  const likeParam = long.params.find((v) => typeof v === 'string' && v.startsWith('%a'));
  assert.ok(typeof likeParam === 'string' && likeParam.length <= 102, 'q is length-capped');
});
