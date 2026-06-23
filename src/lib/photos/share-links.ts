/**
 * Photo share-link generation — mint short-lived, task-scoped read URLs for a
 * set of selected library photos.
 *
 * This is the *ephemeral* sibling of `share-packs.ts`: where a share pack
 * persists a public token + landing page, this helper hands back direct,
 * time-limited GCS v4 signed URLs (default 24h) with no DB writes. It powers the
 * "copy shareable links" / drag-to-share affordance in the photo library, where
 * the operator wants to paste a few URLs into Slack / email / a Zendesk reply
 * without provisioning a durable share page.
 *
 * Security model — links are task-scoped two ways:
 *   1. Every requested id is verified to belong to the caller's organization
 *      before any URL is minted (cross-tenant ids are dropped, not signed).
 *   2. The minted URL is a v4 signed read URL to a single object with a hard
 *      expiry, so it grants read of exactly that one photo for a bounded window.
 * Photos that don't live in GCS (legacy/local storage) fall back to the
 * session-protected `/api/photos/:id/content` proxy URL, which is *not* publicly
 * shareable — callers can see which links are `signed` vs `proxy` and act
 * accordingly.
 *
 * Follows the repo DI convention: `generatePhotoShareLinks(input, deps)` accepts
 * an injectable `Deps` (defaulting to the real DB + GCS adapter) so unit tests
 * run with zero DB / network.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import { getStorageAdapter } from '@/lib/photos/storage/registry';

/** GCS v4 signed URLs cap at 7 days; clamp any requested TTL to that ceiling. */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Default share window when the caller doesn't override (24h, per spec). */
const DEFAULT_TTL_SECONDS = Number(process.env.PHOTOS_SHARE_LINK_TTL_SECONDS || 24 * 60 * 60);
/** Hard cap on links per request — keeps a single sign() fan-out bounded. */
const MAX_PHOTOS_PER_REQUEST = 200;

export interface PhotoShareLink {
  photoId: number;
  /** Human-friendly, de-duplicated download name (e.g. `PO-12345-01.jpg`). */
  filename: string;
  /** The actual shareable URL — a GCS signed URL or the proxy fallback. */
  url: string;
  /** `signed` = public, time-limited GCS URL · `proxy` = session-only fallback. */
  kind: 'signed' | 'proxy';
  /** ISO expiry for `signed` links; `null` for proxy (governed by the session). */
  expiresAt: string | null;
}

export interface GeneratePhotoShareLinksResult {
  links: PhotoShareLink[];
  /** The uniform expiry applied to signed links, for display ("expires in 24h"). */
  expiresAt: string | null;
  /** ids that were requested but not found in the org (surfaced, not signed). */
  missingIds: number[];
  /** Optional durable group landing page — null here; see share-packs.ts. */
  groupUrl: string | null;
}

/** One photo + its primary storage row, as needed to mint a link + filename. */
interface PhotoStorageMetaRow {
  id: number;
  poRef: string | null;
  photoType: string | null;
  provider: string | null;
  bucket: string | null;
  objectKey: string | null;
}

export interface GeneratePhotoShareLinksInput {
  organizationId: string;
  photoIds: number[];
  /** Override the link lifetime (seconds); clamped to GCS' 7-day max. */
  ttlSeconds?: number;
  /** Absolute origin (e.g. `https://app…`) for building proxy fallback URLs. */
  appOrigin: string;
}

export interface ShareLinksDeps {
  /** Fetch id + storage metadata for the requested photos, org-scoped. */
  loadPhotoStorageMeta(
    organizationId: string,
    photoIds: number[],
  ): Promise<PhotoStorageMetaRow[]>;
  /** Mint a signed read URL for one GCS object. */
  signGcsUrl(input: { bucket: string; objectKey: string; ttlSeconds: number }): Promise<string>;
}

/** Real implementations — a single batched query + the GCS adapter. */
const defaultDeps: ShareLinksDeps = {
  async loadPhotoStorageMeta(organizationId, photoIds) {
    // One round-trip for all ids (avoids N per-photo lookups). The LEFT JOIN
    // keeps photos whose primary storage row is missing so they still resolve
    // to a proxy link rather than silently vanishing.
    const res = await tenantQuery<{
      id: string;
      po_ref: string | null;
      photo_type: string | null;
      provider: string | null;
      bucket: string | null;
      object_key: string | null;
    }>(
      organizationId,
      `SELECT p.id, p.po_ref, p.photo_type,
              s.provider, s.bucket, s.object_key
         FROM photos p
         LEFT JOIN photo_storage s
           ON s.photo_id = p.id
          AND s.is_primary = TRUE
          AND s.organization_id = p.organization_id
        WHERE p.organization_id = $1
          AND p.id = ANY($2::bigint[])`,
      [organizationId, photoIds],
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      poRef: r.po_ref,
      photoType: r.photo_type,
      provider: r.provider,
      bucket: r.bucket,
      objectKey: r.object_key,
    }));
  },
  async signGcsUrl(input) {
    return getStorageAdapter('gcs').getSignedReadUrl(input);
  },
};

/** Build a stable, filesystem-safe base name for a photo. */
function baseFilename(row: PhotoStorageMetaRow): string {
  if (row.poRef?.trim()) return `PO-${row.poRef.trim()}`;
  const type = row.photoType?.toLowerCase().replace(/_/g, '-');
  return type ? `${type}` : `photo-${row.id}`;
}

/**
 * Mint share links for `photoIds` belonging to `organizationId`.
 *
 * Returns links in the *requested* order, each tagged `signed` (GCS) or `proxy`
 * (everything else). Cross-org / unknown ids are dropped and reported in
 * `missingIds`. Throws only on bad input (no valid ids) so the route maps it to
 * a 400; individual sign() failures degrade that one link to a proxy URL rather
 * than failing the whole batch.
 */
export async function generatePhotoShareLinks(
  input: GeneratePhotoShareLinksInput,
  deps: ShareLinksDeps = defaultDeps,
): Promise<GeneratePhotoShareLinksResult> {
  // 1. Normalize + validate the id list.
  const uniqueIds = [
    ...new Set(input.photoIds.filter((id) => Number.isFinite(id) && id > 0)),
  ].slice(0, MAX_PHOTOS_PER_REQUEST);
  if (uniqueIds.length === 0) {
    throw new Error('At least one valid photo id is required');
  }

  const ttlSeconds = Math.min(
    Math.max(60, Math.floor(input.ttlSeconds || DEFAULT_TTL_SECONDS)),
    MAX_TTL_SECONDS,
  );
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const origin = input.appOrigin.replace(/\/+$/, '');

  // 2. Load + org-verify in one query; anything not returned is cross-org/missing.
  const rows = await deps.loadPhotoStorageMeta(input.organizationId, uniqueIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missingIds = uniqueIds.filter((id) => !byId.has(id));

  // 3. Mint a link per found photo, in requested order, in parallel. We assign
  //    de-duplicated filenames (PO-12345-01.jpg, …) using the ordinal so a paste
  //    list / future zip never has name collisions.
  const foundIds = uniqueIds.filter((id) => byId.has(id));
  const links = await Promise.all(
    foundIds.map(async (id, index): Promise<PhotoShareLink> => {
      const row = byId.get(id)!;
      const ordinal = String(index + 1).padStart(2, '0');
      const filename = `${baseFilename(row)}-${ordinal}.jpg`;

      // GCS-backed → public, time-limited signed URL (the shareable path).
      if (row.provider === 'gcs' && row.bucket && row.objectKey) {
        try {
          const url = await deps.signGcsUrl({
            bucket: row.bucket,
            objectKey: row.objectKey,
            ttlSeconds,
          });
          return { photoId: id, filename, url, kind: 'signed', expiresAt };
        } catch {
          // Fall through to the proxy URL if signing fails for this object.
        }
      }

      // Fallback: the session-protected content proxy (not publicly shareable).
      return {
        photoId: id,
        filename,
        url: `${origin}/api/photos/${id}/content?download=1`,
        kind: 'proxy',
        expiresAt: null,
      };
    }),
  );

  return { links, expiresAt, missingIds, groupUrl: null };
}
