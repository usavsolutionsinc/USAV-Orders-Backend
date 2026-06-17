/**
 * platform_listings data access — org-scoped reads/writes for the first-class
 * per-channel listing record (see migration 2026-06-17_platform_listings.sql).
 *
 * Everything runs through tenantQuery/withTenantConnection so the org GUC is set
 * and the rows attribute to the right tenant (and stay correct once RLS is
 * FORCEd). The upsert is keyed on the partial-unique (org, platform,
 * external_ref_id) index and carries the sync-hash skip so an unchanged listing
 * neither re-hits the channel nor re-writes the row.
 */
import type { OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import { evaluateSync } from '@/lib/integrations/sync-hash';

export interface PlatformListingInput {
  platform: string;
  externalRefId?: string | null;
  merchantSku?: string | null;
  skuCatalogId?: number | null;
  accountName?: string | null;
  listedName?: string | null;
  listedDescription?: string | null;
  listingPriceCents?: number | null;
  listingQuantity?: number | null;
  listingCondition?: string | null;
  upc?: string | null;
  platformMetadata?: unknown;
}

export interface PlatformListingRow {
  id: number;
  organization_id: string;
  sku_catalog_id: number | null;
  platform: string;
  account_name: string | null;
  external_ref_id: string | null;
  merchant_sku: string | null;
  listing_price_cents: number | null;
  listing_quantity: number | null;
  listing_condition: string | null;
  sync_status: string;
  sync_hash: string | null;
  last_synced_at: Date | null;
  is_active: boolean;
}

/**
 * Insert-or-update a channel listing keyed on (org, platform, external_ref_id).
 * Idempotent: if the incoming content hashes to the stored sync_hash, the row is
 * left untouched and `{ skipped: true }` is returned — no write, no churn.
 *
 * Requires `externalRefId` (the partial-unique key). For listings without a
 * channel id yet, use {@link insertUnresolvedListing}.
 */
export async function upsertPlatformListing(
  orgId: OrgId,
  input: PlatformListingInput,
): Promise<{ id: number; skipped: boolean; hash: string }> {
  if (!input.externalRefId) {
    throw new Error('upsertPlatformListing requires externalRefId; use insertUnresolvedListing otherwise');
  }
  // Hash the channel-facing content so an unchanged listing is a no-op.
  const { hash, unchanged } = await currentHash(orgId, input);
  if (unchanged.skip) {
    return { id: unchanged.id, skipped: true, hash };
  }

  const { rows } = await tenantQuery<{ id: number }>(
    orgId,
    `INSERT INTO platform_listings (
       platform, external_ref_id, merchant_sku, sku_catalog_id, account_name,
       listed_name, listed_description, listing_price_cents, listing_quantity,
       listing_condition, upc, platform_metadata, sync_hash, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (organization_id, platform, external_ref_id)
       WHERE external_ref_id IS NOT NULL
     DO UPDATE SET
       merchant_sku        = EXCLUDED.merchant_sku,
       sku_catalog_id      = COALESCE(EXCLUDED.sku_catalog_id, platform_listings.sku_catalog_id),
       account_name        = EXCLUDED.account_name,
       listed_name         = EXCLUDED.listed_name,
       listed_description  = EXCLUDED.listed_description,
       listing_price_cents = EXCLUDED.listing_price_cents,
       listing_quantity    = EXCLUDED.listing_quantity,
       listing_condition   = EXCLUDED.listing_condition,
       upc                 = EXCLUDED.upc,
       platform_metadata   = EXCLUDED.platform_metadata,
       sync_hash           = EXCLUDED.sync_hash,
       updated_at          = now()
     RETURNING id`,
    [
      input.platform,
      input.externalRefId,
      input.merchantSku ?? null,
      input.skuCatalogId ?? null,
      input.accountName ?? null,
      input.listedName ?? null,
      input.listedDescription ?? null,
      input.listingPriceCents ?? null,
      input.listingQuantity ?? null,
      input.listingCondition ?? null,
      input.upc ?? null,
      input.platformMetadata == null ? null : JSON.stringify(input.platformMetadata),
      hash,
    ],
  );
  return { id: rows[0].id, skipped: false, hash };
}

/** Persist a listing seen on a channel but not yet matched to a catalog SKU.
 *  No external_ref_id means it sits outside the unique index — matching is a
 *  workflow, not a drop (mirrors the ERP's unresolved-listing handling). */
export async function insertUnresolvedListing(
  orgId: OrgId,
  input: Omit<PlatformListingInput, 'externalRefId'>,
): Promise<{ id: number }> {
  const { rows } = await tenantQuery<{ id: number }>(
    orgId,
    `INSERT INTO platform_listings (
       platform, merchant_sku, account_name, listed_name, listing_price_cents,
       listing_quantity, listing_condition, upc, platform_metadata, sync_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')
     RETURNING id`,
    [
      input.platform,
      input.merchantSku ?? null,
      input.accountName ?? null,
      input.listedName ?? null,
      input.listingPriceCents ?? null,
      input.listingQuantity ?? null,
      input.listingCondition ?? null,
      input.upc ?? null,
      input.platformMetadata == null ? null : JSON.stringify(input.platformMetadata),
    ],
  );
  return { id: rows[0].id };
}

/**
 * Resolve a channel order line to a catalog SKU via its listing. Tries
 * external_ref_id first (exact channel id), then merchant_sku. Returns the
 * matched listing row or null (caller can then persist an unresolved listing).
 */
export async function resolveListing(
  orgId: OrgId,
  platform: string,
  opts: { externalRefId?: string | null; merchantSku?: string | null },
): Promise<PlatformListingRow | null> {
  if (opts.externalRefId) {
    const { rows } = await tenantQuery<PlatformListingRow>(
      orgId,
      `SELECT * FROM platform_listings
        WHERE platform = $1 AND external_ref_id = $2 LIMIT 1`,
      [platform, opts.externalRefId],
    );
    if (rows[0]) return rows[0];
  }
  if (opts.merchantSku) {
    const { rows } = await tenantQuery<PlatformListingRow>(
      orgId,
      `SELECT * FROM platform_listings
        WHERE platform = $1 AND merchant_sku = $2
        ORDER BY (sku_catalog_id IS NOT NULL) DESC, id LIMIT 1`,
      [platform, opts.merchantSku],
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

/** Mark a listing's outbound sync result. On success stamps sync_hash so the
 *  next push can skip when unchanged; on failure records the error. */
export async function markListingSynced(
  orgId: OrgId,
  id: number,
  result: { ok: true; hash: string } | { ok: false; error: string },
): Promise<void> {
  if (result.ok) {
    await tenantQuery(
      orgId,
      `UPDATE platform_listings
          SET sync_status='SYNCED', sync_hash=$2, sync_error=NULL,
              last_synced_at=now(), updated_at=now()
        WHERE id=$1`,
      [id, result.hash],
    );
  } else {
    await tenantQuery(
      orgId,
      `UPDATE platform_listings
          SET sync_status='ERROR', sync_error=$2, updated_at=now()
        WHERE id=$1`,
      [id, result.error],
    );
  }
}

/** Internal: compute the content hash and check it against the stored row's
 *  sync_hash so an unchanged upsert can skip the write entirely. */
async function currentHash(
  orgId: OrgId,
  input: PlatformListingInput,
): Promise<{ hash: string; unchanged: { skip: boolean; id: number } }> {
  // The hash covers only the channel-facing content, not bookkeeping columns.
  const content = {
    platform: input.platform,
    externalRefId: input.externalRefId,
    merchantSku: input.merchantSku,
    skuCatalogId: input.skuCatalogId,
    accountName: input.accountName,
    listedName: input.listedName,
    listedDescription: input.listedDescription,
    listingPriceCents: input.listingPriceCents,
    listingQuantity: input.listingQuantity,
    listingCondition: input.listingCondition,
    upc: input.upc,
    platformMetadata: input.platformMetadata,
  };
  const { rows } = await tenantQuery<{ id: number; sync_hash: string | null }>(
    orgId,
    `SELECT id, sync_hash FROM platform_listings
      WHERE platform = $1 AND external_ref_id = $2 LIMIT 1`,
    [input.platform, input.externalRefId],
  );
  const existing = rows[0];
  const { hash, unchanged } = evaluateSync(content, existing?.sync_hash);
  return { hash, unchanged: { skip: Boolean(existing) && unchanged, id: existing?.id ?? 0 } };
}
