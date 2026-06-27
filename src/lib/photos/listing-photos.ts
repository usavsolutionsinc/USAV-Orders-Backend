/**
 * Listing photos — the marketplace gallery composition layer.
 *
 * A listing gallery is an ORDERED, curated set of photos with a single cover,
 * keyed by its target (a catalog SKU or a serialized unit). The rows live in
 * `listing_photos` (see 2026-06-26c). This module owns the gallery invariants —
 * contiguous sort order, exactly one cover, a photo appears once — so the route
 * and UI stay thin.
 *
 * Deps-injected for DB-free unit tests, like `labels.ts` / `image-types.ts`.
 * Every read/write goes through tenantQuery / withTenantTransaction AND keeps an
 * explicit `organization_id = $1` clause.
 */
import type { PoolClient } from 'pg';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/** Which gallery — a catalog SKU's reusable set, or a single unit's set. */
export type ListingTarget = { kind: 'sku'; id: number } | { kind: 'unit'; id: number };

/** Optional channel-listing tags stamped on new rows (platform_listings / serial_unit_listings). */
export interface ListingChannelRefs {
  platformListingId?: number | null;
  serialUnitListingId?: number | null;
}

export interface ListingGalleryItem {
  id: number;
  photoId: number;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
}

export interface ListingPhotoDeps {
  tenantQuery: typeof tenantQuery;
  withTenantTransaction: typeof withTenantTransaction;
}

const defaultDeps: ListingPhotoDeps = { tenantQuery, withTenantTransaction };

export class ListingTargetError extends Error {}

/** The target column + bound value for a gallery, validated. */
function targetColumn(target: ListingTarget): { column: 'sku_catalog_id' | 'serial_unit_id'; id: number } {
  if (!target || !Number.isFinite(target.id) || target.id <= 0) {
    throw new ListingTargetError('A valid listing target id is required');
  }
  return { column: target.kind === 'sku' ? 'sku_catalog_id' : 'serial_unit_id', id: target.id };
}

interface RawGalleryRow {
  id: string | number;
  photo_id: string | number;
  sort_order: number | string;
  is_cover: boolean;
  created_at: string;
}

function mapGalleryRow(row: RawGalleryRow): ListingGalleryItem {
  return {
    id: Number(row.id),
    photoId: Number(row.photo_id),
    sortOrder: Number(row.sort_order),
    isCover: Boolean(row.is_cover),
    createdAt: row.created_at,
  };
}

/** The ordered gallery for a target (cover first within equal sort, then sort_order). */
export async function getListingGallery(
  orgId: OrgId,
  target: ListingTarget,
  deps: ListingPhotoDeps = defaultDeps,
): Promise<ListingGalleryItem[]> {
  const { column, id } = targetColumn(target);
  const res = await deps.tenantQuery<RawGalleryRow>(
    orgId,
    `SELECT id, photo_id, sort_order, is_cover, created_at
       FROM listing_photos
      WHERE organization_id = $1 AND ${column} = $2
      ORDER BY sort_order, id`,
    [orgId, id],
  );
  return res.rows.map(mapGalleryRow);
}

/**
 * Append photos to a gallery (idempotent on the per-gallery unique photo index).
 * New rows sort after the current max; if the gallery was empty, the first added
 * photo becomes the cover. Only photos that exist in the org are inserted.
 */
export async function addPhotosToListing(
  orgId: OrgId,
  target: ListingTarget,
  photoIds: number[],
  channel: ListingChannelRefs = {},
  deps: ListingPhotoDeps = defaultDeps,
): Promise<ListingGalleryItem[]> {
  const { column, id } = targetColumn(target);
  const ids = Array.from(new Set(photoIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return getListingGallery(orgId, target, deps);

  return deps.withTenantTransaction(orgId, async (client) => {
    const startRes = await client.query<{ next: number; count: number }>(
      `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next, COUNT(*)::int AS count
         FROM listing_photos
        WHERE organization_id = $1 AND ${column} = $2`,
      [orgId, id],
    );
    const startOrder = Number(startRes.rows[0]?.next ?? 0);
    const wasEmpty = Number(startRes.rows[0]?.count ?? 0) === 0;

    // Insert in array order; ordinality drives the contiguous sort_order. The
    // first row of a previously-empty gallery is stamped as cover.
    await client.query(
      `INSERT INTO listing_photos
         (organization_id, photo_id, ${column}, platform_listing_id, serial_unit_listing_id,
          sort_order, is_cover)
       SELECT $1, v.pid, $2, $5, $6,
              $3 + (v.ord - 1),
              ($7::boolean AND v.ord = 1)
         FROM unnest($4::bigint[]) WITH ORDINALITY AS v(pid, ord)
         JOIN photos p ON p.id = v.pid AND p.organization_id = $1
       ON CONFLICT (organization_id, ${column}, photo_id) DO NOTHING`,
      [
        orgId,
        id,
        startOrder,
        ids,
        channel.platformListingId ?? null,
        channel.serialUnitListingId ?? null,
        wasEmpty,
      ],
    );

    return readGallery(client, orgId, column, id);
  });
}

/** Reorder the gallery so sort_order matches `orderedPhotoIds`. Unknown ids are ignored. */
export async function reorderListing(
  orgId: OrgId,
  target: ListingTarget,
  orderedPhotoIds: number[],
  deps: ListingPhotoDeps = defaultDeps,
): Promise<ListingGalleryItem[]> {
  const { column, id } = targetColumn(target);
  const order = orderedPhotoIds.filter((n) => Number.isFinite(n) && n > 0);
  return deps.withTenantTransaction(orgId, async (client) => {
    // Set sort_order = position in the supplied array (1-based). Photos not in
    // the array keep a high order so they sort after the explicitly-ordered set.
    await client.query(
      `UPDATE listing_photos lp
          SET sort_order = v.ord
         FROM unnest($3::bigint[]) WITH ORDINALITY AS v(pid, ord)
        WHERE lp.organization_id = $1 AND lp.${column} = $2 AND lp.photo_id = v.pid`,
      [orgId, id, order],
    );
    return readGallery(client, orgId, column, id);
  });
}

/** Promote one photo to cover; clears the previous cover (partial-unique safe). */
export async function setListingCover(
  orgId: OrgId,
  target: ListingTarget,
  photoId: number,
  deps: ListingPhotoDeps = defaultDeps,
): Promise<ListingGalleryItem[]> {
  const { column, id } = targetColumn(target);
  if (!Number.isFinite(photoId) || photoId <= 0) {
    throw new ListingTargetError('A valid photo id is required');
  }
  return deps.withTenantTransaction(orgId, async (client) => {
    // Clear first (so the partial unique cover index is never violated mid-update),
    // then set the new cover only if it belongs to this gallery.
    await client.query(
      `UPDATE listing_photos SET is_cover = FALSE
        WHERE organization_id = $1 AND ${column} = $2 AND is_cover = TRUE`,
      [orgId, id],
    );
    await client.query(
      `UPDATE listing_photos SET is_cover = TRUE
        WHERE organization_id = $1 AND ${column} = $2 AND photo_id = $3`,
      [orgId, id, photoId],
    );
    return readGallery(client, orgId, column, id);
  });
}

/** Remove a photo from a gallery; if it was the cover, promote the new first row. */
export async function removeFromListing(
  orgId: OrgId,
  target: ListingTarget,
  photoId: number,
  deps: ListingPhotoDeps = defaultDeps,
): Promise<ListingGalleryItem[]> {
  const { column, id } = targetColumn(target);
  return deps.withTenantTransaction(orgId, async (client) => {
    const removed = await client.query<{ is_cover: boolean }>(
      `DELETE FROM listing_photos
        WHERE organization_id = $1 AND ${column} = $2 AND photo_id = $3
        RETURNING is_cover`,
      [orgId, id, photoId],
    );
    // If we deleted the cover, promote the lowest-sorted remaining photo.
    if (removed.rows[0]?.is_cover) {
      await client.query(
        `UPDATE listing_photos SET is_cover = TRUE
          WHERE id = (
            SELECT id FROM listing_photos
             WHERE organization_id = $1 AND ${column} = $2
             ORDER BY sort_order, id
             LIMIT 1)`,
        [orgId, id],
      );
    }
    return readGallery(client, orgId, column, id);
  });
}

/** Re-read the gallery on an open client (shared by the mutating helpers). */
async function readGallery(
  client: PoolClient,
  orgId: OrgId,
  column: 'sku_catalog_id' | 'serial_unit_id',
  id: number,
): Promise<ListingGalleryItem[]> {
  const res = await client.query<RawGalleryRow>(
    `SELECT id, photo_id, sort_order, is_cover, created_at
       FROM listing_photos
      WHERE organization_id = $1 AND ${column} = $2
      ORDER BY sort_order, id`,
    [orgId, id],
  );
  return res.rows.map(mapGalleryRow);
}
