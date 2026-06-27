/**
 * Photo "image types" — the library's primary sidebar organizer.
 *
 * Five types are BUILT-IN and defined here in code; they are derived from a
 * photo's capture entity at query time (see `library-filter-state.ts`) and keep
 * their existing GCS layout (entity-derived flow in `storage/path-builder.ts`).
 *
 * Operators can add CUSTOM image types — persisted in `photo_image_types`
 * (org-scoped). Each custom type carries:
 *   - `key`        — matched against `photos.photo_type` at upload + query time
 *                    (no new column on the hot photos table).
 *   - `gcsPrefix`  — so its photos land under a distinct bucket path,
 *                    `{org}/{gcsPrefix}/{yyyy}/{mm}/…` (see `path-builder.ts`).
 *
 * All reads/writes go through `tenantQuery` / `withTenantTransaction` (SET LOCAL
 * app.current_org) AND keep an explicit `organization_id = $1` clause — belt and
 * suspenders while the app connects as a BYPASSRLS role. Writes are audited by
 * the `/api/photos/image-types` route.
 */
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { PhotoLibrarySourceScope } from './library-filter-state';

export interface BuiltInImageType {
  kind: 'builtin';
  /** Equals a library source scope; drives the entity-derived query + flow. */
  key: Exclude<PhotoLibrarySourceScope, 'all'>;
  label: string;
  /** Icon glyph name (mapped to a component in the sidebar; lib stays UI-free). */
  icon: string;
}

export interface CustomImageType {
  kind: 'custom';
  id: number;
  key: string;
  label: string;
  gcsPrefix: string;
  icon: string | null;
  sortIndex: number;
  /** Seeded system type (e.g. 'listing') — non-deletable / non-renamable, pinned first. */
  isSystem: boolean;
}

export type ImageType = BuiltInImageType | CustomImageType;

/** The five built-in types (SoT for the sidebar's fixed rows). */
export const BUILTIN_IMAGE_TYPES: BuiltInImageType[] = [
  { kind: 'builtin', key: 'unboxing', label: 'Unboxing', icon: 'PackageOpen' },
  { kind: 'builtin', key: 'local_pickup', label: 'Pickups', icon: 'ShoppingCart' },
  { kind: 'builtin', key: 'packing', label: 'Packing', icon: 'Package' },
  { kind: 'builtin', key: 'repair', label: 'Repair', icon: 'Wrench' },
  { kind: 'builtin', key: 'claims', label: 'Claims', icon: 'MessageSquare' },
];

const BUILTIN_KEYS = new Set<string>(BUILTIN_IMAGE_TYPES.map((t) => t.key));

/**
 * Keys reserved for seeded SYSTEM image types (photo_image_types.is_system). They
 * exist as rows (so they carry a gcs_prefix + photoType tag) but must not be
 * re-created or collided with by an operator. 'listing' is the marketplace
 * listing-photo type (see 2026-06-26b_photo_listing_type.sql).
 */
export const SYSTEM_IMAGE_TYPE_KEYS = new Set<string>(['listing']);

export interface ImageTypeDeps {
  tenantQuery: typeof tenantQuery;
  withTenantTransaction: typeof withTenantTransaction;
}

const defaultDeps: ImageTypeDeps = { tenantQuery, withTenantTransaction };

export class ImageTypeConflictError extends Error {}
export class ImageTypeValidationError extends Error {}

interface RawImageTypeRow {
  id: string | number;
  key: string;
  label: string;
  gcs_prefix: string;
  icon: string | null;
  sort_index: number | string;
  is_system: boolean;
}

function mapRow(row: RawImageTypeRow): CustomImageType {
  return {
    kind: 'custom',
    id: Number(row.id),
    key: row.key,
    label: row.label,
    gcsPrefix: row.gcs_prefix,
    icon: row.icon ?? null,
    sortIndex: Number(row.sort_index),
    isSystem: Boolean(row.is_system),
  };
}

/** Lowercase, path-safe slug used as both the `key` and the `gcs_prefix`. */
export function slugifyImageType(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'type'
  );
}

/** Custom image types for an org, ordered for stable sidebar rendering. */
export async function listCustomImageTypes(
  orgId: OrgId,
  deps: ImageTypeDeps = defaultDeps,
): Promise<CustomImageType[]> {
  const res = await deps.tenantQuery<RawImageTypeRow>(
    orgId,
    `SELECT id, key, label, gcs_prefix, icon, sort_index, is_system
       FROM photo_image_types
      WHERE organization_id = $1
      ORDER BY sort_index, id`,
    [orgId],
  );
  return res.rows.map(mapRow);
}

/** Built-ins followed by the org's custom types. */
export async function listImageTypes(
  orgId: OrgId,
  deps: ImageTypeDeps = defaultDeps,
): Promise<{ builtIn: BuiltInImageType[]; custom: CustomImageType[] }> {
  return { builtIn: BUILTIN_IMAGE_TYPES, custom: await listCustomImageTypes(orgId, deps) };
}

/** Create a custom image type. The key/prefix derive from the label (slug). */
export async function createImageType(
  orgId: OrgId,
  input: { label: string; icon?: string | null },
  deps: ImageTypeDeps = defaultDeps,
): Promise<CustomImageType> {
  const label = input.label.trim();
  if (!label) throw new ImageTypeValidationError('A name is required');
  if (label.length > 60) throw new ImageTypeValidationError('Name is too long');
  const key = slugifyImageType(label);
  if (BUILTIN_KEYS.has(key) || SYSTEM_IMAGE_TYPE_KEYS.has(key)) {
    throw new ImageTypeConflictError(`"${label}" collides with a built-in image type`);
  }

  return deps.withTenantTransaction(orgId, async (client) => {
    const dup = await client.query(
      `SELECT 1 FROM photo_image_types WHERE organization_id = $1 AND lower(key) = $2 LIMIT 1`,
      [orgId, key],
    );
    if (dup.rows.length > 0) {
      throw new ImageTypeConflictError(`An image type "${label}" already exists`);
    }
    const next = await client.query<RawImageTypeRow>(
      `INSERT INTO photo_image_types (organization_id, key, label, gcs_prefix, icon, sort_index, is_system)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(sort_index) + 1 FROM photo_image_types WHERE organization_id = $1), 0),
               FALSE)
       RETURNING id, key, label, gcs_prefix, icon, sort_index, is_system`,
      [orgId, key, label, key, input.icon ?? null],
    );
    return mapRow(next.rows[0]);
  });
}

/**
 * The GCS path prefix for a photo's image type, or `undefined` to fall back to
 * the entity-derived flow. Only CUSTOM types (matched on `photoType` = key)
 * override the path; built-ins keep their existing layout untouched.
 */
export async function resolveGcsPrefix(
  orgId: OrgId,
  photoType: string | null | undefined,
  deps: ImageTypeDeps = defaultDeps,
): Promise<string | undefined> {
  const key = photoType?.trim().toLowerCase();
  if (!key || BUILTIN_KEYS.has(key)) return undefined;
  const res = await deps.tenantQuery<{ gcs_prefix: string }>(
    orgId,
    `SELECT gcs_prefix FROM photo_image_types WHERE organization_id = $1 AND lower(key) = $2 LIMIT 1`,
    [orgId, key],
  );
  return res.rows[0]?.gcs_prefix ?? undefined;
}
