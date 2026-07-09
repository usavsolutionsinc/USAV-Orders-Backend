/**
 * DB-free unit tests for buildSearchContextBlock (Phase 2c).
 * Run: npx tsx --test src/lib/ai/search-context.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  buildSearchContextBlock,
  looksLikeRetrievalQuestion,
  type SearchContextDeps,
} from './search-context';
import type { SearchHit } from '@/lib/search/search-hit';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  id: 1,
  entityType: 'order',
  title: 'Bose SoundLink Revolve',
  subtitle: '12-345 · ebay',
  href: '/o/1',
  matchField: 'keyword',
  score: 50,
  chips: [],
  facets: { status: 'shipped', condition_grade: null, source_platform: 'ebay' },
  ...over,
});

function fakes(hits: SearchHit[], usedSemantic = false) {
  const calls: Array<{ orgId: OrgId; query: string }> = [];
  const deps: SearchContextDeps = {
    search: async (orgId, query) => {
      calls.push({ orgId, query });
      return { hits, usedSemantic };
    },
  };
  return { deps, calls };
}

test('retrieval heuristic: find/where/which yes; chitchat and metrics no', () => {
  for (const q of [
    'find the bose revolve order',
    'where is serial ABC123',
    'do we have any samsung phones in stock',
    'show me ebay returns from june',
    'what is the status of order 12-345',
  ]) {
    assert.equal(looksLikeRetrievalQuestion(q), true, `"${q}" should trigger retrieval`);
  }
  for (const q of ['hello', 'thanks!', 'how fast was packing today']) {
    assert.equal(looksLikeRetrievalQuestion(q), false, `"${q}" should NOT trigger retrieval`);
  }
});

test('builds a formatted block with type, title, facets, and href; org threaded', async () => {
  const { deps, calls } = fakes([hit()]);
  const block = await buildSearchContextBlock(ORG, 'find the bose revolve order', deps);
  assert.ok(block);
  assert.ok(block.startsWith('=== ENTITY SEARCH (hybrid, top 1) ==='));
  assert.ok(block.includes('[order] Bose SoundLink Revolve'));
  assert.ok(block.includes('status=shipped'));
  assert.ok(block.includes('platform=ebay'));
  assert.ok(block.includes('/o/1'));
  assert.equal(calls[0].orgId, ORG);
});

test('semantic flag surfaces in the header', async () => {
  const { deps } = fakes([hit()], true);
  const block = await buildSearchContextBlock(ORG, 'find bose', deps);
  assert.ok(block?.includes('hybrid + semantic'));
});

test('non-retrieval message: no search call, null block', async () => {
  const { deps, calls } = fakes([hit()]);
  const block = await buildSearchContextBlock(ORG, 'good morning', deps);
  assert.equal(block, null);
  assert.equal(calls.length, 0);
});

test('zero hits → null (no empty block noise in the prompt)', async () => {
  const { deps } = fakes([]);
  assert.equal(await buildSearchContextBlock(ORG, 'find the widget', deps), null);
});

test('search failure degrades to null, never throws (chat enrichment contract)', async () => {
  const deps: SearchContextDeps = {
    search: async () => {
      throw new Error('db down');
    },
  };
  assert.equal(await buildSearchContextBlock(ORG, 'find the widget', deps), null);
});

test('blank message → null', async () => {
  const { deps, calls } = fakes([hit()]);
  assert.equal(await buildSearchContextBlock(ORG, '   ', deps), null);
  assert.equal(calls.length, 0);
});
