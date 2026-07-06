/**
 * search-outbox-worker — drains entity_search_outbox into entity_search_docs.
 *
 * The single write path for search docs (locked decision 5: DB trigger →
 * outbox → worker; domain helpers are never edited). Flow per drain call:
 *
 *   claim N pending rows (FOR UPDATE SKIP LOCKED, attempts+1)
 *     → group by org, then entity type
 *     → load parent rows org-scoped (tenantQuery — GUC + explicit org filter)
 *     → buildSearchText per row
 *     → embedText over the batch, BEST-EFFORT: on failure the docs still
 *       upsert with search_text and embedding NULL, so keyword search is
 *       fresh immediately and the next backfill/enqueue retries the embed
 *     → upsert docs (org-led natural key), delete docs whose parent vanished
 *     → mark outbox rows processed (or failed with the error message)
 *
 * Cross-org claim/mark run on the owner pool (BYPASSRLS — same posture as
 * other cron drains); all parent reads and doc writes are org-scoped.
 * Idempotent: re-processing a row re-upserts the same doc; a crash between
 * claim and mark leaves the row pending (attempts counts the retry).
 */

import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { embedText } from '@/lib/ai/embed';
import { EMBEDDING_DIMS } from '@/lib/ai/provider';
import { resolveOrgAiConfig, type OrgAiConfig } from '@/lib/ai/org-provider';
import { recordAiUsage, type RecordAiUsage } from '@/lib/ai/usage';
import {
  buildSearchText,
  isSearchEntityType,
  type BuiltSearchDoc,
  type SearchEntityType,
  type SearchSourceRow,
} from '@/lib/search/build-search-text';

export interface OutboxClaim {
  id: number;
  organizationId: OrgId;
  entityType: SearchEntityType;
  entityId: number;
}

export interface SearchDocUpsert extends BuiltSearchDoc {
  entityType: SearchEntityType;
  entityId: number;
  /** NULL when the embed call failed or embeddings are unconfigured. */
  embedding: number[] | null;
  /** Model that produced `embedding` (per-org embedding-space integrity). */
  embeddedModel: string | null;
}

export interface SearchOutboxDeps {
  claimPending(limit: number): Promise<OutboxClaim[]>;
  loadEntityRows(
    orgId: OrgId,
    entityType: SearchEntityType,
    ids: number[],
  ): Promise<Array<SearchSourceRow & { id: number }>>;
  /** Per-org provider resolution: BYOK vault → platform default → null. */
  resolveEmbedConfig(orgId: OrgId): Promise<OrgAiConfig | null>;
  /** Throws on failure — the worker maps a throw to embedding-NULL upserts. */
  embed(texts: string[], config: OrgAiConfig): Promise<{ vectors: number[][]; promptTokens: number }>;
  recordUsage: RecordAiUsage;
  upsertDocs(orgId: OrgId, docs: SearchDocUpsert[]): Promise<void>;
  deleteDocs(orgId: OrgId, refs: Array<{ entityType: SearchEntityType; entityId: number }>): Promise<void>;
  markProcessed(outboxIds: number[]): Promise<void>;
  markFailed(outboxIds: number[], error: string): Promise<void>;
}

export interface DrainResult {
  claimed: number;
  upserted: number;
  embedded: number;
  deleted: number;
  failed: number;
}

// ── Real implementations ────────────────────────────────────────────────────

const LOADER_SQL: Record<SearchEntityType, string> = {
  ORDER: `
    SELECT o.id, o.order_id, o.product_title, o.sku, o.account_source,
           o.status, o.condition, o.notes, o.order_date, o.created_at,
           COALESCE(STRING_AGG(DISTINCT tsn.serial_number, ' '), '') AS serials,
           MAX(stn.tracking_number_raw)                              AS tracking_number,
           MAX(NULLIF(stn.carrier, 'UNKNOWN'))                       AS carrier
    FROM orders o
    LEFT JOIN tech_serial_numbers tsn       ON tsn.shipment_id = o.shipment_id
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
    WHERE o.organization_id = $1 AND o.id = ANY($2::bigint[])
    GROUP BY o.id`,
  SERIAL_UNIT: `
    SELECT su.id, su.serial_number, su.unit_uid, su.sku,
           su.current_status::text  AS current_status,
           su.condition_grade::text AS condition_grade,
           su.current_location, su.notes, su.received_at, su.created_at,
           su.shipping_tracking_number,
           COALESCE(i.name, sc.product_title) AS product_title
    FROM serial_units su
    LEFT JOIN sku_catalog sc ON sc.id = su.sku_catalog_id
    LEFT JOIN items i        ON i.zoho_item_id = su.zoho_item_id
    WHERE su.organization_id = $1 AND su.id = ANY($2::bigint[])`,
  // `receiving` is a security_invoker compat view (receiving-spine rename), so
  // Postgres can't prove PK functional dependency — a GROUP BY r.id would
  // reject the bare r.* columns ("column r.carrier must appear in GROUP BY").
  // Aggregate the only 1:many join (receiving_lines) in a LATERAL so the outer
  // SELECT needs no GROUP BY at all; stn is 1:1 on shipment_id.
  RECEIVING: `
    SELECT r.id,
           stn.tracking_number_raw                                AS tracking_number,
           COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)    AS carrier,
           r.zoho_purchaseorder_number                            AS po_number,
           r.source_platform, r.intake_type, r.exception_code,
           r.support_notes, r.zoho_notes,
           r.condition_grade::text AS condition_grade,
           r.qa_status::text       AS qa_status,
           r.received_at, r.created_at,
           lines.line_item_names, lines.line_skus
    FROM receiving r
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(STRING_AGG(DISTINCT rl.item_name, ' '), '') AS line_item_names,
             COALESCE(STRING_AGG(DISTINCT rl.sku, ' '), '')       AS line_skus
      FROM receiving_lines rl WHERE rl.receiving_id = r.id
    ) lines ON TRUE
    WHERE r.organization_id = $1 AND r.id = ANY($2::bigint[])`,
  SKU: `
    SELECT id, sku, product_title, category, upc, ean, gtin, notes,
           lifecycle_status, is_active, created_at, updated_at
    FROM sku_catalog
    WHERE organization_id = $1 AND id = ANY($2::bigint[])`,
  REPAIR: `
    SELECT id, ticket_number, product_title, serial_number, issue, notes,
           status, source_system, source_order_id, source_tracking_number,
           source_sku, received_at, created_at
    FROM repair_service
    WHERE organization_id = $1 AND id = ANY($2::bigint[])`,
  FBA_SHIPMENT: `
    SELECT f.id, f.shipment_ref, f.amazon_shipment_id, f.destination_fc,
           f.status, f.notes, f.due_date, f.shipped_at, f.created_at,
           COALESCE(STRING_AGG(DISTINCT fsi.product_title, ' '), '') AS item_titles,
           COALESCE(STRING_AGG(DISTINCT fsi.sku, ' '), '')           AS item_skus,
           COALESCE(STRING_AGG(DISTINCT fsi.fnsku, ' '), '')         AS item_fnskus,
           COALESCE(STRING_AGG(DISTINCT fsi.asin, ' '), '')          AS item_asins
    FROM fba_shipments f
    LEFT JOIN fba_shipment_items fsi ON fsi.shipment_id = f.id
    WHERE f.organization_id = $1 AND f.id = ANY($2::bigint[])
    GROUP BY f.id`,
};

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** After this many claim attempts a row dead-letters (processed_at stamped,
 *  last_error kept) — poison rows must never starve the queue head. */
const ATTEMPTS_CAP = 5;

const defaultDeps: SearchOutboxDeps = {
  async claimPending(limit) {
    // Crash recovery: a drain that died between claim and mark leaves
    // claimed_at set with processed_at NULL — release those claims so the
    // rows become claimable again (attempts already counted the try).
    await pool.query(
      `UPDATE entity_search_outbox
       SET claimed_at = NULL
       WHERE processed_at IS NULL
         AND claimed_at < now() - INTERVAL '15 minutes'`,
    );
    // Claim = stamp claimed_at. A claimed row no longer matches the
    // pending-dedupe partial unique (… AND claimed_at IS NULL), so a parent
    // write DURING the drain inserts a FRESH pending row instead of being
    // silently deduped against the in-flight snapshot (the review's blocker).
    // attempts < ATTEMPTS_CAP keeps poison rows from starving the queue head.
    const res = await pool.query(
      `UPDATE entity_search_outbox
       SET attempts = attempts + 1, claimed_at = now()
       WHERE id IN (
         SELECT id FROM entity_search_outbox
         WHERE processed_at IS NULL AND claimed_at IS NULL AND attempts < ${ATTEMPTS_CAP}
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, organization_id, entity_type, entity_id`,
      [limit],
    );
    // NOTE: unknown entity_type rows are NOT filtered here — the drain
    // dead-letters them via markFailed so they can't be re-claimed forever.
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      organizationId: String(r.organization_id) as OrgId,
      entityType: String(r.entity_type) as SearchEntityType,
      entityId: Number(r.entity_id),
    }));
  },

  async loadEntityRows(orgId, entityType, ids) {
    const res = await tenantQuery(orgId, LOADER_SQL[entityType], [orgId, ids]);
    return res.rows.map((r: any) => ({ ...r, id: Number(r.id) }));
  },

  resolveEmbedConfig: (orgId) => resolveOrgAiConfig(orgId, 'embed'),
  async embed(texts, config) {
    let promptTokens = 0;
    const vectors = await embedText(texts, {
      config,
      onUsage: ({ promptTokens: t }) => {
        promptTokens += t;
      },
    });
    return { vectors, promptTokens };
  },
  recordUsage: recordAiUsage,

  async upsertDocs(orgId, docs) {
    if (docs.length === 0) return;
    // One UNNEST-batched statement per org per drain — N sequential
    // single-row transactions would multiply round trips (each tenantQuery
    // opens BEGIN/set_config/COMMIT), the exact CU-hour pattern to avoid.
    await tenantQuery(
      orgId,
      `INSERT INTO entity_search_docs
         (organization_id, entity_type, entity_id, title, subtitle,
          search_text, embedding, embedded_at, embedded_model, status,
          condition_grade, source_platform, tracking_number, carrier,
          happened_at, updated_at)
       SELECT $1,
              t.entity_type, t.entity_id, t.title, t.subtitle, t.search_text,
              t.embedding_text::vector(${EMBEDDING_DIMS}),
              CASE WHEN t.embedding_text IS NULL THEN NULL ELSE now() END,
              t.embedded_model,
              t.status, t.condition_grade, t.source_platform,
              t.tracking_number, t.carrier, t.happened_at,
              now()
       FROM UNNEST(
         $2::text[], $3::bigint[], $4::text[], $5::text[], $6::text[],
         $7::text[], $8::text[], $9::text[], $10::text[], $11::timestamptz[],
         $12::text[], $13::text[], $14::text[]
       ) AS t(entity_type, entity_id, title, subtitle, search_text,
              embedding_text, status, condition_grade, source_platform, happened_at,
              embedded_model, tracking_number, carrier)
       ON CONFLICT (organization_id, entity_type, entity_id)
       DO UPDATE SET
         title           = EXCLUDED.title,
         subtitle        = EXCLUDED.subtitle,
         search_text     = EXCLUDED.search_text,
         -- Keep an existing embedding when this pass couldn't embed —
         -- stale-but-present beats NULL for the semantic arm; the text
         -- columns above are always freshest.
         embedding       = COALESCE(EXCLUDED.embedding, entity_search_docs.embedding),
         embedded_at     = COALESCE(EXCLUDED.embedded_at, entity_search_docs.embedded_at),
         embedded_model  = COALESCE(EXCLUDED.embedded_model, entity_search_docs.embedded_model),
         status          = EXCLUDED.status,
         condition_grade = EXCLUDED.condition_grade,
         source_platform = EXCLUDED.source_platform,
         tracking_number = EXCLUDED.tracking_number,
         carrier         = EXCLUDED.carrier,
         happened_at     = EXCLUDED.happened_at,
         updated_at      = now()`,
      [
        orgId,
        docs.map((d) => d.entityType),
        docs.map((d) => d.entityId),
        docs.map((d) => d.title),
        docs.map((d) => d.subtitle),
        docs.map((d) => d.searchText),
        docs.map((d) => (d.embedding ? toVectorLiteral(d.embedding) : null)),
        docs.map((d) => d.facets.status),
        docs.map((d) => d.facets.conditionGrade),
        docs.map((d) => d.facets.sourcePlatform),
        docs.map((d) => d.facets.happenedAt),
        docs.map((d) => d.embeddedModel),
        docs.map((d) => d.facets.trackingNumber),
        docs.map((d) => d.facets.carrier),
      ],
    );
  },

  async deleteDocs(orgId, refs) {
    if (refs.length === 0) return;
    await tenantQuery(
      orgId,
      `DELETE FROM entity_search_docs
       WHERE organization_id = $1
         AND (entity_type, entity_id) IN (
           SELECT * FROM UNNEST($2::text[], $3::bigint[])
         )`,
      [orgId, refs.map((r) => r.entityType), refs.map((r) => r.entityId)],
    );
  },

  async markProcessed(outboxIds) {
    if (outboxIds.length === 0) return;
    await pool.query(
      `UPDATE entity_search_outbox SET processed_at = now(), last_error = NULL
       WHERE id = ANY($1::bigint[])`,
      [outboxIds],
    );
  },

  async markFailed(outboxIds, error) {
    if (outboxIds.length === 0) return;
    // Release the claim so the row is retryable; once attempts hits the cap
    // it dead-letters (processed_at stamped, last_error kept) instead of
    // starving the queue head forever.
    await pool.query(
      `UPDATE entity_search_outbox
       SET last_error = $2,
           claimed_at = NULL,
           processed_at = CASE WHEN attempts >= ${ATTEMPTS_CAP} THEN now() ELSE processed_at END
       WHERE id = ANY($1::bigint[])`,
      [outboxIds, error.slice(0, 500)],
    );
  },
};

// ── Embedding retry sweep (Phase 3, org-aware) ──────────────────────────────
//
// A doc whose embed failed (or that was indexed before the org had a
// provider) carries embedding NULL and would otherwise wait for its parent
// row to be touched again. The sweep re-enqueues stale NULL-embedding docs
// PER ORG, and only for orgs that can actually embed right now (BYOK vault
// or platform default) — for an unlinked tenant, NULL is the steady state,
// and re-enqueueing would churn the queue forever.

export interface EmbedRetryDeps {
  /** Orgs that currently have stale NULL-embedding docs. */
  listOrgsWithNullEmbeddings(olderThanMinutes: number, maxOrgs: number): Promise<OrgId[]>;
  /** Per-org provider resolution (cached) — null = org can't embed, skip. */
  resolveEmbedConfig(orgId: OrgId): Promise<OrgAiConfig | null>;
  /** Re-enqueue one org's stale NULL-embedding docs. */
  enqueueNullEmbeddingDocs(orgId: OrgId, limit: number, olderThanMinutes: number): Promise<number>;
}

const defaultRetryDeps: EmbedRetryDeps = {
  async listOrgsWithNullEmbeddings(olderThanMinutes, maxOrgs) {
    const res = await pool.query(
      `SELECT organization_id
       FROM entity_search_docs
       WHERE embedding IS NULL
         AND updated_at < now() - ($1::int * INTERVAL '1 minute')
       GROUP BY organization_id
       ORDER BY COUNT(*) DESC
       LIMIT $2`,
      [olderThanMinutes, maxOrgs],
    );
    return res.rows.map((r: any) => String(r.organization_id) as OrgId);
  },
  resolveEmbedConfig: (orgId) => resolveOrgAiConfig(orgId, 'embed'),
  async enqueueNullEmbeddingDocs(orgId, limit, olderThanMinutes) {
    const res = await pool.query(
      `INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
       SELECT organization_id, entity_type, entity_id
       FROM entity_search_docs
       WHERE organization_id = $1
         AND embedding IS NULL
         AND updated_at < now() - ($3::int * INTERVAL '1 minute')
       ORDER BY updated_at ASC
       LIMIT $2
       ON CONFLICT (organization_id, entity_type, entity_id)
       WHERE processed_at IS NULL AND claimed_at IS NULL
       DO NOTHING`,
      [orgId, limit, olderThanMinutes],
    );
    return res.rowCount ?? 0;
  },
};

export async function sweepEmbeddingRetries(
  opts: { limit?: number; olderThanMinutes?: number } = {},
  deps: EmbedRetryDeps = defaultRetryDeps,
): Promise<number> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const olderThanMinutes = Math.max(opts.olderThanMinutes ?? 30, 1);
  const orgs = await deps.listOrgsWithNullEmbeddings(olderThanMinutes, 20);
  let total = 0;
  for (const orgId of orgs) {
    if (total >= limit) break;
    const config = await deps.resolveEmbedConfig(orgId);
    if (!config) continue; // unlinked tenant — NULL is steady state
    total += await deps.enqueueNullEmbeddingDocs(orgId, limit - total, olderThanMinutes);
  }
  return total;
}

/**
 * Re-enqueue EVERY doc for one org — called when the org connects, switches,
 * or disconnects an AI provider, so its whole corpus re-embeds in the new
 * model's space (docs and queries must share one embedding space; mixed
 * models poison cosine relevance). Enqueue-only: the worker drains at its
 * own pace. Idempotent via the pending-dedupe unique.
 */
export async function enqueueOrgReembed(orgId: OrgId): Promise<number> {
  const res = await pool.query(
    `INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
     SELECT organization_id, entity_type, entity_id
     FROM entity_search_docs
     WHERE organization_id = $1
     ON CONFLICT (organization_id, entity_type, entity_id)
     WHERE processed_at IS NULL AND claimed_at IS NULL
     DO NOTHING`,
    [orgId],
  );
  return res.rowCount ?? 0;
}

// ── Orchestration ───────────────────────────────────────────────────────────

export async function drainSearchOutbox(
  opts: { batchSize?: number } = {},
  deps: SearchOutboxDeps = defaultDeps,
): Promise<DrainResult> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 50, 1), 200);
  const result: DrainResult = { claimed: 0, upserted: 0, embedded: 0, deleted: 0, failed: 0 };

  const claims = await deps.claimPending(batchSize);
  result.claimed = claims.length;
  if (claims.length === 0) return result;

  // Unknown discriminator values (e.g. a 7th entity type whose migration
  // landed before the code deploy) dead-letter via markFailed — silently
  // re-claiming them forever would stall the queue and skew the drain loop.
  const known = claims.filter((c) => isSearchEntityType(String(c.entityType)));
  const unknown = claims.filter((c) => !isSearchEntityType(String(c.entityType)));
  if (unknown.length > 0) {
    await deps.markFailed(
      unknown.map((c) => c.id),
      `unsupported entity_type (worker predates it): ${[...new Set(unknown.map((c) => c.entityType))].join(', ')}`,
    );
    result.failed += unknown.length;
  }

  const byOrg = new Map<OrgId, OutboxClaim[]>();
  for (const claim of known) {
    const list = byOrg.get(claim.organizationId) ?? [];
    list.push(claim);
    byOrg.set(claim.organizationId, list);
  }

  for (const [orgId, orgClaims] of byOrg) {
    try {
      const byType = new Map<SearchEntityType, OutboxClaim[]>();
      for (const claim of orgClaims) {
        const list = byType.get(claim.entityType) ?? [];
        list.push(claim);
        byType.set(claim.entityType, list);
      }

      const docs: SearchDocUpsert[] = [];
      const gone: Array<{ entityType: SearchEntityType; entityId: number }> = [];

      for (const [entityType, typeClaims] of byType) {
        const ids = typeClaims.map((c) => c.entityId);
        const rows = await deps.loadEntityRows(orgId, entityType, ids);
        const found = new Set(rows.map((r) => r.id));
        for (const row of rows) {
          docs.push({
            entityType,
            entityId: row.id,
            embedding: null,
            embeddedModel: null,
            ...buildSearchText(entityType, row),
          });
        }
        for (const id of ids) {
          // Parent vanished between enqueue and drain → remove any stale doc
          // (the delete trigger normally handles this; self-heal regardless).
          if (!found.has(id)) gone.push({ entityType, entityId: id });
        }
      }

      // Best-effort embed with the ORG's provider (BYOK vault → platform
      // default → none). A failure or an unlinked tenant NEVER blocks the
      // doc upsert — keyword search stays fresh, embedding stays NULL.
      const embedConfig = docs.length > 0 ? await deps.resolveEmbedConfig(orgId) : null;
      if (docs.length > 0 && embedConfig) {
        try {
          const { vectors, promptTokens } = await deps.embed(
            docs.map((d) => d.searchText),
            embedConfig,
          );
          if (vectors.length === docs.length) {
            docs.forEach((doc, i) => {
              doc.embedding = vectors[i];
              doc.embeddedModel = embedConfig.model;
            });
            result.embedded += vectors.length;
            if (promptTokens > 0) {
              deps.recordUsage({
                orgId,
                capability: 'embed',
                source: embedConfig.source,
                model: embedConfig.model,
                context: 'doc_embed',
                inputTokens: promptTokens,
              });
            }
          }
        } catch {
          // leave embeddings NULL; retried on next enqueue/backfill
        }
      }

      if (docs.length > 0) await deps.upsertDocs(orgId, docs);
      if (gone.length > 0) await deps.deleteDocs(orgId, gone);
      await deps.markProcessed(orgClaims.map((c) => c.id));
      result.upserted += docs.length;
      result.deleted += gone.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await deps.markFailed(
        orgClaims.map((c) => c.id),
        message,
      );
      result.failed += orgClaims.length;
    }
  }

  return result;
}
