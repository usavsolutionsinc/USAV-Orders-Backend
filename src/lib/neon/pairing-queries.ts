/**
 * Pairing hub query helpers.
 *
 * One source of truth for the suggestion scoring and the batch-pair writes —
 * the on-demand /api/sku-catalog/suggest-pairings endpoint and the nightly
 * refresh cron both call into here so they can't drift apart.
 *
 * Scoring tiers (until UPC data is reliable — see Phase 0.5):
 *   - title trigram similarity        (primary, capped at 85)
 *   - order volume on the same item   (+0..10 bonus)
 *   - account_source ↔ platform match (+5 bonus)
 *   - MPN/model token overlap         (+0..10 bonus)
 *   - UPC/EAN/GTIN exact              (100, opt-in via PAIRING_USE_UPC_TIER)
 *
 * The `reason` string is human-readable so the Product Hub can render
 * `"trigram_0.74 + order_count_8 + platform_match"` under the confidence dot.
 */

import pool from '../db';
import type { PoolClient } from 'pg';
import type {
  PairingAuditAction,
  PairingAuditActorKind,
} from './sku-catalog-queries';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Floor below which we don't bother surfacing a candidate. Operators told us
 * "show me everything that's plausible"; <40 has been pure noise in practice.
 */
export const PAIRING_DISPLAY_FLOOR = 40;

/**
 * Pre-selection threshold in the Product Hub. ≥80 = one-keypress accept.
 * No auto-pair anywhere — even score 100 still requires human Save.
 */
export const PAIRING_PRESELECT_THRESHOLD = 80;

/** Platforms the suggestion engine will rank against. */
export const SUPPORTED_PLATFORMS = [
  'amazon',
  'fba',
  'ebay',
  'ecwid',
  'walmart',
  'mercari',
  'shopify',
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PairingCandidate {
  platformIdRowId: number;
  platform: string;
  platformSku: string | null;
  platformItemId: string | null;
  accountName: string | null;
  listingTitle: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  confidence: number;
  reason: string;
  orderCount: number;
}

export interface ConfirmedPairing {
  platformIdRowId: number;
  platform: string;
  platformSku: string | null;
  platformItemId: string | null;
  accountName: string | null;
  listingTitle: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  confidence: number | null;
  pairedBy: number | null;
  pairedAt: string | null;
}

export interface PairingSnapshot {
  skuCatalogId: number;
  canonicalSku: string;
  canonicalTitle: string | null;
  confirmed: Record<string, ConfirmedPairing[]>;
  suggestions: Record<string, PairingCandidate[]>;
}

// ─── account_source → platform inference (mirrors sku-catalog-queries.ts) ───

function inferPlatformFromAccountSource(src: string | null | undefined): string | null {
  const s = (src || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('ebay')) return 'ebay';
  if (s === 'ecwid') return 'ecwid';
  if (s === 'fba' || s === 'amazon_fba') return 'fba';
  if (s.startsWith('amazon') || s.startsWith('amz')) return 'amazon';
  if (s.startsWith('walmart')) return 'walmart';
  if (s.startsWith('mercari')) return 'mercari';
  if (s.startsWith('shopify')) return 'shopify';
  return null;
}

// ─── Suggestion query ───────────────────────────────────────────────────────

/**
 * Pull ranked candidates for one canonical SKU across all platforms.
 *
 * One query (not N) — uses a CTE that joins unpaired sku_platform_ids rows
 * against sku_catalog, scores them, and orders by confidence. Caller filters
 * by platform via the perPlatformLimit grouping in JS so the SQL stays simple.
 */
export async function suggestPairingsForSku(
  skuCatalogId: number,
  perPlatformLimit = 5,
): Promise<PairingSnapshot> {
  const catalogResult = await pool.query<{
    id: number;
    sku: string;
    product_title: string | null;
  }>(
    `SELECT id, sku, product_title
       FROM sku_catalog
      WHERE id = $1
      LIMIT 1`,
    [skuCatalogId],
  );
  if (catalogResult.rows.length === 0) {
    throw new Error(`sku_catalog id=${skuCatalogId} not found`);
  }
  const catalog = catalogResult.rows[0];

  // ── Confirmed (already paired) — one row per existing mapping ─────────────
  const confirmedResult = await pool.query<{
    platformIdRowId: number;
    platform: string;
    platformSku: string | null;
    platformItemId: string | null;
    accountName: string | null;
    listingTitle: string | null;
    listingUrl: string | null;
    imageUrl: string | null;
    confidence: number | null;
    pairedBy: number | null;
    pairedAt: string | null;
  }>(
    `SELECT
       sp.id               AS "platformIdRowId",
       sp.platform,
       sp.platform_sku     AS "platformSku",
       sp.platform_item_id AS "platformItemId",
       sp.account_name     AS "accountName",
       COALESCE(sp.listing_title, sp.display_name) AS "listingTitle",
       sp.listing_url      AS "listingUrl",
       sp.image_url        AS "imageUrl",
       sp.confidence,
       sp.paired_by        AS "pairedBy",
       to_char(sp.paired_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS "pairedAt"
     FROM sku_platform_ids sp
     WHERE (sp.sku_catalog_id = $1 OR sp.platform_sku = $2)
       AND sp.is_active = true
     ORDER BY sp.platform ASC, sp.account_name ASC NULLS LAST`,
    [catalog.id, catalog.sku],
  );

  // ── Candidates: read from the materialized sku_pairing_suggestions table ──
  // The cron does the heavy similarity-ranked scan once; the Hub does a
  // tight join here so panel opens stay sub-100ms even with thousands of
  // un-paired rows in sku_platform_ids.
  //
  // If the cron hasn't run yet (empty table for this catalog id), the
  // operator's "Refresh suggestions" button can re-trigger the cron — but
  // we deliberately do NOT recompute on the hot path; that's what blew up
  // the first version of this query (regexp_replace lateral × 5k rows).
  const candidatesResult = await pool.query<{
    platformIdRowId: number;
    platform: string;
    platformSku: string | null;
    platformItemId: string | null;
    accountName: string | null;
    listingTitle: string | null;
    listingUrl: string | null;
    imageUrl: string | null;
    confidence: number;
    reason: string;
  }>(
    `SELECT
       sp.id                          AS "platformIdRowId",
       sp.platform                    AS "platform",
       sp.platform_sku                AS "platformSku",
       sp.platform_item_id            AS "platformItemId",
       sp.account_name                AS "accountName",
       COALESCE(sp.listing_title, sp.display_name) AS "listingTitle",
       sp.listing_url                 AS "listingUrl",
       sp.image_url                   AS "imageUrl",
       s.confidence                   AS "confidence",
       s.reason                       AS "reason"
     FROM sku_pairing_suggestions s
     JOIN sku_platform_ids sp ON sp.id = s.platform_id_row_id
     WHERE s.sku_catalog_id = $1
       AND sp.is_active = true
       AND sp.sku_catalog_id IS NULL
       AND (sp.do_not_suggest_until IS NULL OR sp.do_not_suggest_until < NOW())
     ORDER BY s.confidence DESC`,
    [catalog.id],
  );

  const candidates: PairingCandidate[] = candidatesResult.rows.map((row) => ({
    platformIdRowId: row.platformIdRowId,
    platform: row.platform,
    platformSku: row.platformSku,
    platformItemId: row.platformItemId,
    accountName: row.accountName,
    listingTitle: row.listingTitle,
    listingUrl: row.listingUrl,
    imageUrl: row.imageUrl,
    confidence: row.confidence,
    reason: row.reason,
    orderCount: 0,
  }));

  // Group + cap per platform
  const suggestions: Record<string, PairingCandidate[]> = {};
  for (const platform of SUPPORTED_PLATFORMS) suggestions[platform] = [];
  for (const c of candidates) {
    if (c.confidence < PAIRING_DISPLAY_FLOOR) continue;
    const bucket = c.platform.toLowerCase();
    if (!suggestions[bucket]) suggestions[bucket] = [];
    if (suggestions[bucket].length >= perPlatformLimit) continue;
    suggestions[bucket].push(c);
  }

  const confirmed: Record<string, ConfirmedPairing[]> = {};
  for (const platform of SUPPORTED_PLATFORMS) confirmed[platform] = [];
  for (const row of confirmedResult.rows) {
    const bucket = row.platform.toLowerCase();
    if (!confirmed[bucket]) confirmed[bucket] = [];
    confirmed[bucket].push(row);
  }

  return {
    skuCatalogId: catalog.id,
    canonicalSku: catalog.sku,
    canonicalTitle: catalog.product_title,
    confirmed,
    suggestions,
  };
}

// ─── Batch pair: atomic accept/reject + backfills + audit ──────────────────

export interface BatchPairInput {
  skuCatalogId: number;
  actorId: number;
  actorKind?: PairingAuditActorKind; // defaults to 'user'
  accept: Array<
    | { platformIdRowId: number; confidence?: number; reason?: string }
    | {
        platform: string;
        platformSku?: string | null;
        platformItemId?: string | null;
        accountName?: string | null;
        listingTitle?: string | null;
        listingUrl?: string | null;
        confidence?: number;
        reason?: string;
      }
  >;
  reject: Array<{ platformIdRowId: number; reason?: string }>;
  unpair?: Array<{ platformIdRowId: number; reason?: string }>;
}

export interface BatchPairResult {
  pairsCreated: number;
  pairsUnchanged: number;
  rejections: number;
  unpairs: number;
  ordersBackfilled: number;
  manualsBackfilled: number;
  auditIds: number[];
}

export async function batchPair(input: BatchPairInput): Promise<BatchPairResult> {
  const actorKind: PairingAuditActorKind = input.actorKind ?? 'user';
  const client = await pool.connect();
  const auditIds: number[] = [];

  try {
    await client.query('BEGIN');

    // Confirm the catalog row exists (locks it for the txn)
    const catalogLock = await client.query<{ id: number; sku: string }>(
      `SELECT id, sku FROM sku_catalog WHERE id = $1 FOR UPDATE`,
      [input.skuCatalogId],
    );
    if (catalogLock.rows.length === 0) {
      throw new Error(`sku_catalog id=${input.skuCatalogId} not found`);
    }

    let pairsCreated = 0;
    let pairsUnchanged = 0;
    const acceptedItemNumbers = new Set<string>();

    // ── Accepts ────────────────────────────────────────────────────────────
    for (const a of input.accept) {
      let rowId: number;
      let before: unknown = null;
      let after: unknown = null;

      if ('platformIdRowId' in a) {
        const before$ = await client.query(
          `SELECT * FROM sku_platform_ids WHERE id = $1 FOR UPDATE`,
          [a.platformIdRowId],
        );
        if (before$.rows.length === 0) continue;
        before = before$.rows[0];

        // Idempotent: if already linked to the same catalog id, no-op
        if (before$.rows[0].sku_catalog_id === input.skuCatalogId) {
          pairsUnchanged += 1;
          rowId = a.platformIdRowId;
        } else {
          const updated = await client.query(
            `UPDATE sku_platform_ids
                SET sku_catalog_id = $1,
                    confidence     = COALESCE($2::smallint, confidence),
                    paired_by      = $3,
                    paired_at      = NOW(),
                    is_active      = true
              WHERE id = $4
              RETURNING *`,
            [input.skuCatalogId, a.confidence ?? null, input.actorId, a.platformIdRowId],
          );
          after = updated.rows[0];
          pairsCreated += 1;
          rowId = a.platformIdRowId;
        }
      } else {
        // Inline creation — operator typed a mapping that isn't in
        // sku_platform_ids yet. Use the same idempotent path the existing
        // upsertSkuPlatformId does, scoped to this transaction.
        const inserted = await client.query(
          `INSERT INTO sku_platform_ids
             (sku_catalog_id, platform, platform_sku, platform_item_id,
              account_name, listing_title, listing_url, confidence,
              paired_by, paired_at, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), true)
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [
            input.skuCatalogId,
            a.platform,
            a.platformSku ?? null,
            a.platformItemId ?? null,
            a.accountName ?? null,
            a.listingTitle ?? null,
            a.listingUrl ?? null,
            a.confidence ?? null,
            input.actorId,
          ],
        );
        if (inserted.rows.length > 0) {
          after = inserted.rows[0];
          rowId = inserted.rows[0].id;
          pairsCreated += 1;
        } else {
          // Conflict — claim the existing row by setting sku_catalog_id.
          const claim = await client.query(
            `UPDATE sku_platform_ids
                SET sku_catalog_id = $1,
                    listing_title  = COALESCE(listing_title, $6),
                    listing_url    = COALESCE(listing_url, $7),
                    confidence     = COALESCE($8::smallint, confidence),
                    paired_by      = $9,
                    paired_at      = NOW(),
                    is_active      = true
              WHERE platform = $2
                AND COALESCE(platform_sku, '')      = COALESCE($3, '')
                AND COALESCE(platform_item_id, '')  = COALESCE($4, '')
                AND COALESCE(account_name, '')      = COALESCE($5, '')
              RETURNING *`,
            [
              input.skuCatalogId,
              a.platform,
              a.platformSku ?? null,
              a.platformItemId ?? null,
              a.accountName ?? null,
              a.listingTitle ?? null,
              a.listingUrl ?? null,
              a.confidence ?? null,
              input.actorId,
            ],
          );
          if (claim.rows.length === 0) continue;
          after = claim.rows[0];
          rowId = claim.rows[0].id;
          pairsCreated += 1;
        }
      }

      const itemNumber =
        (after as any)?.platform_item_id ??
        (after as any)?.platform_sku ??
        (before as any)?.platform_item_id ??
        (before as any)?.platform_sku;
      if (itemNumber) acceptedItemNumbers.add(String(itemNumber));

      const auditId = await writeAudit(client, {
        skuCatalogId: input.skuCatalogId,
        platformIdRowId: rowId,
        action: 'accept',
        confidence: a.confidence ?? null,
        reason: a.reason ?? null,
        actorId: input.actorId,
        actorKind,
        before,
        after,
      });
      auditIds.push(auditId);
    }

    // ── Rejects ────────────────────────────────────────────────────────────
    let rejections = 0;
    for (const r of input.reject) {
      // Push the candidate out of suggestions for 30 days. Don't alter
      // the mapping itself — operator just said "not this one, not now".
      const updated = await client.query(
        `UPDATE sku_platform_ids
            SET do_not_suggest_until = NOW() + interval '30 days'
          WHERE id = $1
          RETURNING *`,
        [r.platformIdRowId],
      );
      if (updated.rows.length === 0) continue;
      rejections += 1;

      const auditId = await writeAudit(client, {
        skuCatalogId: input.skuCatalogId,
        platformIdRowId: r.platformIdRowId,
        action: 'reject',
        confidence: null,
        reason: r.reason ?? null,
        actorId: input.actorId,
        actorKind,
        before: null,
        after: updated.rows[0],
      });
      auditIds.push(auditId);

      // Drop any matching suggestion row so the Hub refreshes cleanly
      await client.query(
        `DELETE FROM sku_pairing_suggestions
          WHERE sku_catalog_id = $1 AND platform_id_row_id = $2`,
        [input.skuCatalogId, r.platformIdRowId],
      );
    }

    // ── Unpairs (undo) ─────────────────────────────────────────────────────
    let unpairs = 0;
    for (const u of input.unpair ?? []) {
      const before$ = await client.query(
        `SELECT * FROM sku_platform_ids WHERE id = $1 FOR UPDATE`,
        [u.platformIdRowId],
      );
      if (before$.rows.length === 0) continue;
      const updated = await client.query(
        `UPDATE sku_platform_ids
            SET sku_catalog_id = NULL,
                confidence     = NULL,
                paired_by      = NULL,
                paired_at      = NULL
          WHERE id = $1
          RETURNING *`,
        [u.platformIdRowId],
      );
      unpairs += 1;
      const auditId = await writeAudit(client, {
        skuCatalogId: input.skuCatalogId,
        platformIdRowId: u.platformIdRowId,
        action: 'unpair',
        confidence: null,
        reason: u.reason ?? null,
        actorId: input.actorId,
        actorKind,
        before: before$.rows[0],
        after: updated.rows[0],
      });
      auditIds.push(auditId);
    }

    // ── Backfill orders + product_manuals once for the whole batch ─────────
    let ordersBackfilled = 0;
    let manualsBackfilled = 0;
    if (acceptedItemNumbers.size > 0) {
      const itemNumbers = [...acceptedItemNumbers];
      const ordersBackfill = await client.query(
        `UPDATE orders
            SET sku_catalog_id = $1
          WHERE sku_catalog_id IS NULL
            AND item_number IS NOT NULL
            AND regexp_replace(UPPER(TRIM(item_number)), '[^A-Z0-9]', '', 'g')
                = ANY($2::text[])`,
        [
          input.skuCatalogId,
          itemNumbers.map((n) =>
            n.toUpperCase().replace(/[^A-Z0-9]/g, ''),
          ),
        ],
      );
      ordersBackfilled = ordersBackfill.rowCount ?? 0;

      const manualsBackfill = await client.query(
        `UPDATE product_manuals
            SET sku_catalog_id = $1
          WHERE sku_catalog_id IS NULL
            AND item_number IS NOT NULL
            AND regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g')
                = ANY($2::text[])`,
        [
          input.skuCatalogId,
          itemNumbers.map((n) =>
            n.toUpperCase().replace(/[^A-Z0-9]/g, ''),
          ),
        ],
      );
      manualsBackfilled = manualsBackfill.rowCount ?? 0;
    }

    await client.query('COMMIT');

    return {
      pairsCreated,
      pairsUnchanged,
      rejections,
      unpairs,
      ordersBackfilled,
      manualsBackfilled,
      auditIds,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Audit write helper ─────────────────────────────────────────────────────

async function writeAudit(
  client: PoolClient,
  params: {
    skuCatalogId: number;
    platformIdRowId: number | null;
    action: PairingAuditAction;
    confidence: number | null;
    reason: string | null;
    actorId: number | null;
    actorKind: PairingAuditActorKind;
    before: unknown;
    after: unknown;
  },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO sku_pairing_audit
       (sku_catalog_id, platform_id_row_id, action, confidence, reason,
        actor_id, actor_kind, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING id`,
    [
      params.skuCatalogId,
      params.platformIdRowId,
      params.action,
      params.confidence,
      params.reason,
      params.actorId,
      params.actorKind,
      params.before ? JSON.stringify(params.before) : null,
      params.after ? JSON.stringify(params.after) : null,
    ],
  );
  return result.rows[0].id;
}

// ─── Cron-driven suggestion refresh (writes to suggestions table only) ─────

/**
 * Materializes suggestions for every catalog row that has at least one
 * un-paired platform candidate above the trigram-similarity threshold.
 *
 * Single bulk SQL — no N+1 round-trips. Runs in seconds even with thousands
 * of un-paired platform rows thanks to the gin_trgm GIN index added in the
 * 2026-05-25 migration.
 *
 * Called from /api/cron/sku-catalog/refresh-suggestions. NEVER writes to
 * sku_platform_ids — pairings stay human-reviewed.
 *
 * Trade-off: this bulk path uses title-similarity only (no order-volume
 * bonus). suggestPairingsForSku() applies the full ranker when an operator
 * opens a product; the materialized table is the index that drives the
 * queue list + sidebar badge.
 */
export async function refreshAllSuggestions(): Promise<{
  catalogsScanned: number;
  suggestionsWritten: number;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE sku_pairing_suggestions`);

    const inserted = await client.query<{ count: number }>(
      `WITH scored AS (
         SELECT
           sc.id                              AS sku_catalog_id,
           sp.id                              AS platform_id_row_id,
           sp.platform                        AS platform,
           similarity(sc.product_title, COALESCE(sp.listing_title, sp.display_name, '')) AS sim
         FROM sku_catalog sc
         JOIN sku_platform_ids sp
           ON sp.sku_catalog_id IS NULL
          AND sp.is_active = true
          AND (sp.do_not_suggest_until IS NULL OR sp.do_not_suggest_until < NOW())
          AND similarity(sc.product_title, COALESCE(sp.listing_title, sp.display_name, '')) > 0.20
         WHERE sc.is_active = true
       ),
       ranked AS (
         SELECT
           sku_catalog_id,
           platform_id_row_id,
           sim,
           LEAST(95, GREATEST(0, ROUND(sim * 85)::int)) AS confidence,
           ROW_NUMBER() OVER (
             PARTITION BY sku_catalog_id, LOWER(platform)
             ORDER BY sim DESC
           ) AS rn
         FROM scored
       ),
       inserted AS (
         INSERT INTO sku_pairing_suggestions
           (sku_catalog_id, platform_id_row_id, confidence, reason)
         SELECT
           sku_catalog_id,
           platform_id_row_id,
           confidence,
           'trigram_' || to_char(sim, 'FM0.00') AS reason
         FROM ranked
         WHERE rn <= 5
           AND confidence >= ${PAIRING_DISPLAY_FLOOR}
         ON CONFLICT (sku_catalog_id, platform_id_row_id)
         DO UPDATE SET confidence   = EXCLUDED.confidence,
                       reason       = EXCLUDED.reason,
                       refreshed_at = NOW()
         RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM inserted`,
    );

    const catalogCount = await client.query<{ count: number }>(
      `SELECT COUNT(DISTINCT sku_catalog_id)::int AS count FROM sku_pairing_suggestions`,
    );

    await client.query('COMMIT');

    return {
      catalogsScanned: catalogCount.rows[0]?.count ?? 0,
      suggestionsWritten: inserted.rows[0]?.count ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
