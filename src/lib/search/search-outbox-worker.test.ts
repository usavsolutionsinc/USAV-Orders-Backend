/**
 * DB-free unit tests for drainSearchOutbox — Deps fakes capture every
 * collaborator call; no pool, no network.
 * Run: npx tsx --test src/lib/search/search-outbox-worker.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  drainSearchOutbox,
  sweepEmbeddingRetries,
  type OutboxClaim,
  type SearchDocUpsert,
  type SearchOutboxDeps,
} from './search-outbox-worker';
import type { OrgAiConfig } from '@/lib/ai/org-provider';
import type { AiUsageInput } from '@/lib/ai/usage';
import type { SearchEntityType, SearchSourceRow } from './build-search-text';

const ORG_A = '00000000-0000-0000-0000-00000000000a' as OrgId;
const ORG_B = '00000000-0000-0000-0000-00000000000b' as OrgId;

const VEC = new Array(768).fill(0.1);
const EMBED_CONFIG: OrgAiConfig = {
  source: 'ai_gateway',
  baseURL: 'https://gw.example/v1',
  apiKey: 'k',
  model: 'openai/text-embedding-3-small',
};

interface Captured {
  loads: Array<{ orgId: OrgId; entityType: SearchEntityType; ids: number[] }>;
  embeds: string[][];
  usage: AiUsageInput[];
  upserts: Array<{ orgId: OrgId; docs: SearchDocUpsert[] }>;
  deletes: Array<{ orgId: OrgId; refs: Array<{ entityType: SearchEntityType; entityId: number }> }>;
  processed: number[][];
  failed: Array<{ ids: number[]; error: string }>;
}

function fakes(opts: {
  claims?: OutboxClaim[];
  rows?: Partial<Record<SearchEntityType, Array<SearchSourceRow & { id: number }>>>;
  embedThrows?: boolean;
  embedConfigured?: boolean;
  upsertThrows?: boolean;
} = {}) {
  const cap: Captured = { loads: [], embeds: [], usage: [], upserts: [], deletes: [], processed: [], failed: [] };
  const deps: SearchOutboxDeps = {
    claimPending: async () => opts.claims ?? [],
    loadEntityRows: async (orgId, entityType, ids) => {
      cap.loads.push({ orgId, entityType, ids });
      return (opts.rows?.[entityType] ?? []).filter((r) => ids.includes(r.id));
    },
    resolveEmbedConfig: async () => (opts.embedConfigured === false ? null : EMBED_CONFIG),
    embed: async (texts, _config) => {
      cap.embeds.push(texts);
      if (opts.embedThrows) throw new Error('embed provider down');
      return { vectors: texts.map(() => VEC), promptTokens: texts.length * 10 };
    },
    recordUsage: (u) => {
      cap.usage.push(u);
    },
    upsertDocs: async (orgId, docs) => {
      if (opts.upsertThrows) throw new Error('upsert boom');
      cap.upserts.push({ orgId, docs });
    },
    deleteDocs: async (orgId, refs) => {
      cap.deletes.push({ orgId, refs });
    },
    markProcessed: async (ids) => {
      cap.processed.push(ids);
    },
    markFailed: async (ids, error) => {
      cap.failed.push({ ids, error });
    },
  };
  return { deps, cap };
}

const claim = (id: number, org: OrgId, entityType: SearchEntityType, entityId: number): OutboxClaim => ({
  id,
  organizationId: org,
  entityType,
  entityId,
});

test('happy path: loads org-scoped, embeds, upserts with vectors, marks processed', async () => {
  const { deps, cap } = fakes({
    claims: [claim(1, ORG_A, 'SKU', 11), claim(2, ORG_A, 'SKU', 12)],
    rows: {
      SKU: [
        { id: 11, sku: 'A', product_title: 'Alpha' },
        { id: 12, sku: 'B', product_title: 'Beta' },
      ],
    },
  });
  const res = await drainSearchOutbox({ batchSize: 10 }, deps);

  assert.deepEqual(res, { claimed: 2, upserted: 2, embedded: 2, deleted: 0, failed: 0 });
  assert.equal(cap.loads.length, 1);
  assert.equal(cap.loads[0].orgId, ORG_A); // org threaded, never defaulted
  assert.deepEqual(cap.loads[0].ids, [11, 12]);
  assert.equal(cap.upserts.length, 1);
  assert.equal(cap.upserts[0].docs[0].embedding, VEC);
  assert.equal(cap.upserts[0].docs[0].embeddedModel, EMBED_CONFIG.model); // embedding-space stamp
  assert.equal(cap.upserts[0].docs[0].title, 'Alpha');
  assert.deepEqual(cap.processed, [[1, 2]]);
  assert.equal(cap.failed.length, 0);
  // doc_embed usage metered once per org batch with the provider source.
  assert.equal(cap.usage.length, 1);
  assert.equal(cap.usage[0].context, 'doc_embed');
  assert.equal(cap.usage[0].source, 'ai_gateway');
  assert.equal(cap.usage[0].inputTokens, 20);
});

test('embed failure degrades: docs still upsert with NULL embedding, rows processed', async () => {
  const { deps, cap } = fakes({
    claims: [claim(1, ORG_A, 'SKU', 11)],
    rows: { SKU: [{ id: 11, sku: 'A', product_title: 'Alpha' }] },
    embedThrows: true,
  });
  const res = await drainSearchOutbox({}, deps);

  assert.equal(res.upserted, 1);
  assert.equal(res.embedded, 0);
  assert.equal(res.failed, 0);
  assert.equal(cap.upserts[0].docs[0].embedding, null); // keyword-fresh, embed retried later
  assert.deepEqual(cap.processed, [[1]]);
});

test('embed unconfigured: never calls embed, upserts keyword-only docs', async () => {
  const { deps, cap } = fakes({
    claims: [claim(1, ORG_A, 'SKU', 11)],
    rows: { SKU: [{ id: 11, sku: 'A', product_title: 'Alpha' }] },
    embedConfigured: false,
  });
  const res = await drainSearchOutbox({}, deps);

  assert.equal(cap.embeds.length, 0);
  assert.equal(res.upserted, 1);
  assert.equal(cap.upserts[0].docs[0].embedding, null);
});

test('vanished parent: doc deleted, outbox row still processed', async () => {
  const { deps, cap } = fakes({
    claims: [claim(1, ORG_A, 'ORDER', 42), claim(2, ORG_A, 'ORDER', 43)],
    rows: { ORDER: [{ id: 42, product_title: 'Still here' }] },
  });
  const res = await drainSearchOutbox({}, deps);

  assert.equal(res.upserted, 1);
  assert.equal(res.deleted, 1);
  assert.deepEqual(cap.deletes[0].refs, [{ entityType: 'ORDER', entityId: 43 }]);
  assert.deepEqual(cap.processed, [[1, 2]]);
});

test('multi-org batch: each org loads/upserts under its own id; one org failing does not block the other', async () => {
  const { deps, cap } = fakes({
    claims: [claim(1, ORG_A, 'SKU', 11), claim(2, ORG_B, 'REPAIR', 5)],
    rows: {
      SKU: [{ id: 11, sku: 'A', product_title: 'Alpha' }],
      REPAIR: [{ id: 5, ticket_number: 'RS-5', product_title: 'Amp' }],
    },
  });
  const res = await drainSearchOutbox({}, deps);

  assert.equal(res.upserted, 2);
  const orgs = cap.upserts.map((u) => u.orgId).sort();
  assert.deepEqual(orgs, [ORG_A, ORG_B]);
  // Each upsert carried only its own org's docs.
  for (const u of cap.upserts) assert.equal(u.docs.length, 1);
});

test('upsert failure marks that org failed (with error), never processed', async () => {
  const { deps, cap } = fakes({
    claims: [claim(1, ORG_A, 'SKU', 11)],
    rows: { SKU: [{ id: 11, sku: 'A', product_title: 'Alpha' }] },
    upsertThrows: true,
  });
  const res = await drainSearchOutbox({}, deps);

  assert.equal(res.failed, 1);
  assert.equal(res.upserted, 0);
  assert.equal(cap.processed.length, 0);
  assert.equal(cap.failed.length, 1);
  assert.deepEqual(cap.failed[0].ids, [1]);
  assert.match(cap.failed[0].error, /upsert boom/);
});

test('unknown entity_type claims dead-letter via markFailed, never silently re-claim', async () => {
  const { deps, cap } = fakes({
    claims: [
      claim(1, ORG_A, 'SKU', 11),
      // Simulates a 7th discriminator value whose migration landed before
      // this worker build (migration-first house deploy order).
      claim(2, ORG_A, 'WARRANTY_CLAIM' as SearchEntityType, 5),
    ],
    rows: { SKU: [{ id: 11, sku: 'A', product_title: 'Alpha' }] },
  });
  const res = await drainSearchOutbox({}, deps);

  assert.equal(res.claimed, 2);
  assert.equal(res.upserted, 1);
  assert.equal(res.failed, 1);
  assert.equal(cap.failed.length, 1);
  assert.deepEqual(cap.failed[0].ids, [2]);
  assert.match(cap.failed[0].error, /unsupported entity_type/);
  assert.match(cap.failed[0].error, /WARRANTY_CLAIM/);
  // The valid claim still processed normally.
  assert.deepEqual(cap.processed, [[1]]);
});

test('empty queue is a no-op', async () => {
  const { deps, cap } = fakes({ claims: [] });
  const res = await drainSearchOutbox({}, deps);
  assert.deepEqual(res, { claimed: 0, upserted: 0, embedded: 0, deleted: 0, failed: 0 });
  assert.equal(cap.loads.length, 0);
});

// ── sweepEmbeddingRetries (org-aware) ───────────────────────────────────────

test('embed retry sweep: enqueues per qualifying org with threaded params', async () => {
  const calls: Array<{ orgId: OrgId; limit: number; olderThanMinutes: number }> = [];
  const n = await sweepEmbeddingRetries(
    { limit: 120, olderThanMinutes: 45 },
    {
      listOrgsWithNullEmbeddings: async () => [ORG_A],
      resolveEmbedConfig: async () => EMBED_CONFIG,
      enqueueNullEmbeddingDocs: async (orgId, limit, olderThanMinutes) => {
        calls.push({ orgId, limit, olderThanMinutes });
        return 7;
      },
    },
  );
  assert.equal(n, 7);
  assert.deepEqual(calls, [{ orgId: ORG_A, limit: 120, olderThanMinutes: 45 }]);
});

test('embed retry sweep: unlinked orgs are skipped (NULL is their steady state)', async () => {
  const calls: OrgId[] = [];
  const n = await sweepEmbeddingRetries(
    {},
    {
      listOrgsWithNullEmbeddings: async () => [ORG_A, ORG_B],
      // ORG_A has no provider; ORG_B can embed.
      resolveEmbedConfig: async (orgId) => (orgId === ORG_B ? EMBED_CONFIG : null),
      enqueueNullEmbeddingDocs: async (orgId) => {
        calls.push(orgId);
        return 3;
      },
    },
  );
  assert.equal(n, 3);
  assert.deepEqual(calls, [ORG_B]);
});

test('embed retry sweep: total limit shared across orgs, clamped to [1, 500]', async () => {
  const seen: Array<{ orgId: OrgId; limit: number }> = [];
  const deps = {
    listOrgsWithNullEmbeddings: async () => [ORG_A, ORG_B],
    resolveEmbedConfig: async () => EMBED_CONFIG,
    enqueueNullEmbeddingDocs: async (orgId: OrgId, limit: number) => {
      seen.push({ orgId, limit });
      return limit; // consume the whole allowance
    },
  };
  const n = await sweepEmbeddingRetries({ limit: 10_000 }, deps);
  assert.equal(n, 500);            // clamp
  assert.equal(seen.length, 1);    // budget exhausted after the first org
  assert.equal(seen[0].limit, 500);
});
