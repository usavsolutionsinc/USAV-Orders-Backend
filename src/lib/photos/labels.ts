/**
 * Photo labels — the library's orthogonal, many-to-many tagging axis.
 *
 * A photo has ONE image type (photo_image_types / photos.photo_type) but MANY
 * labels (front / back / serial-tag / defect / accessories / box …). Labels are
 * an org-scoped vocabulary in `photo_labels`; assignments live in
 * `photo_label_assignments` (UNIQUE per photo+label).
 *
 * Mirrors `image-types.ts`: Deps-injected for DB-free unit tests; every read and
 * write goes through `tenantQuery` / `withTenantTransaction` (SET LOCAL
 * app.current_org) AND keeps an explicit `organization_id = $1` clause (belt and
 * suspenders while the app connects as a BYPASSRLS role). Writes are audited by
 * the `/api/photos/labels*` routes.
 *
 * `is_system` labels (seeded listing angles) are non-deletable / non-renamable.
 * `color` is validated against the semantic-token registry in `label-colors.ts`.
 */
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  DEFAULT_LABEL_COLOR,
  isLabelColorToken,
  type LabelColorToken,
} from './label-colors';

export interface PhotoLabel {
  id: number;
  key: string;
  label: string;
  color: LabelColorToken;
  icon: string | null;
  /** When set, the label is primarily surfaced inside that image type's flow. */
  scopeImageType: string | null;
  isSystem: boolean;
  sortIndex: number;
}

export interface LabelDeps {
  tenantQuery: typeof tenantQuery;
  withTenantTransaction: typeof withTenantTransaction;
}

const defaultDeps: LabelDeps = { tenantQuery, withTenantTransaction };

export class LabelConflictError extends Error {}
export class LabelValidationError extends Error {}
export class LabelNotFoundError extends Error {}
/** Thrown when a write targets an is_system label (rename/delete is blocked). */
export class LabelSystemGuardError extends Error {}

interface RawLabelRow {
  id: string | number;
  key: string;
  label: string;
  color: string | null;
  icon: string | null;
  scope_image_type: string | null;
  is_system: boolean;
  sort_index: number | string;
}

function mapRow(row: RawLabelRow): PhotoLabel {
  return {
    id: Number(row.id),
    key: row.key,
    label: row.label,
    color: isLabelColorToken(row.color) ? row.color : DEFAULT_LABEL_COLOR,
    icon: row.icon ?? null,
    scopeImageType: row.scope_image_type ?? null,
    isSystem: Boolean(row.is_system),
    sortIndex: Number(row.sort_index),
  };
}

const LABEL_COLS = `id, key, label, color, icon, scope_image_type, is_system, sort_index`;

/** Lowercase, path-safe slug used as the label `key` (the filter token). */
export function slugifyLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'label'
  );
}

function normalizeColorInput(color: unknown): LabelColorToken {
  return isLabelColorToken(color) ? color : DEFAULT_LABEL_COLOR;
}

/** All labels for an org, ordered for stable rendering. `scopeImageType` filters when set. */
export async function listLabels(
  orgId: OrgId,
  opts: { scopeImageType?: string | null } = {},
  deps: LabelDeps = defaultDeps,
): Promise<PhotoLabel[]> {
  const params: unknown[] = [orgId];
  let scopeClause = '';
  if (opts.scopeImageType) {
    params.push(opts.scopeImageType);
    // Match the scoped labels OR globals (NULL scope), so a listing flow shows
    // both its angle labels and any org-wide labels.
    scopeClause = ` AND (scope_image_type = $${params.length} OR scope_image_type IS NULL)`;
  }
  const res = await deps.tenantQuery<RawLabelRow>(
    orgId,
    `SELECT ${LABEL_COLS}
       FROM photo_labels
      WHERE organization_id = $1${scopeClause}
      ORDER BY sort_index, id`,
    params,
  );
  return res.rows.map(mapRow);
}

/** Create a custom label. The key derives from the label (slug). */
export async function createLabel(
  orgId: OrgId,
  input: { label: string; color?: string | null; icon?: string | null; scopeImageType?: string | null },
  deps: LabelDeps = defaultDeps,
): Promise<PhotoLabel> {
  const label = input.label.trim();
  if (!label) throw new LabelValidationError('A name is required');
  if (label.length > 60) throw new LabelValidationError('Name is too long');
  const key = slugifyLabel(label);
  const color = normalizeColorInput(input.color);
  const icon = typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim() : null;
  const scopeImageType =
    typeof input.scopeImageType === 'string' && input.scopeImageType.trim()
      ? input.scopeImageType.trim().toLowerCase()
      : null;

  return deps.withTenantTransaction(orgId, async (client) => {
    const dup = await client.query(
      `SELECT 1 FROM photo_labels WHERE organization_id = $1 AND lower(key) = $2 LIMIT 1`,
      [orgId, key],
    );
    if (dup.rows.length > 0) {
      throw new LabelConflictError(`A label "${label}" already exists`);
    }
    const next = await client.query<RawLabelRow>(
      `INSERT INTO photo_labels
         (organization_id, key, label, color, icon, scope_image_type, is_system, sort_index)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE,
               COALESCE((SELECT MAX(sort_index) + 1 FROM photo_labels WHERE organization_id = $1), 0))
       RETURNING ${LABEL_COLS}`,
      [orgId, key, label, color, icon, scopeImageType],
    );
    return mapRow(next.rows[0]);
  });
}

/**
 * Rename / recolor a custom label. System labels are immutable (guarded) — the
 * route maps the guard error to 409. The `key` is intentionally NOT changed on
 * rename so existing assignments and any saved filters keep resolving.
 */
export async function updateLabel(
  orgId: OrgId,
  id: number,
  patch: { label?: string; color?: string | null; icon?: string | null },
  deps: LabelDeps = defaultDeps,
): Promise<PhotoLabel> {
  return deps.withTenantTransaction(orgId, async (client) => {
    const existing = await client.query<RawLabelRow>(
      `SELECT ${LABEL_COLS} FROM photo_labels
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [id, orgId],
    );
    if (existing.rowCount === 0) throw new LabelNotFoundError('Label not found');
    if (existing.rows[0].is_system) {
      throw new LabelSystemGuardError('System labels cannot be edited');
    }

    const nextLabel =
      typeof patch.label === 'string' && patch.label.trim() ? patch.label.trim() : existing.rows[0].label;
    if (nextLabel.length > 60) throw new LabelValidationError('Name is too long');
    const nextColor =
      patch.color === undefined ? existing.rows[0].color : normalizeColorInput(patch.color);
    const nextIcon =
      patch.icon === undefined
        ? existing.rows[0].icon
        : typeof patch.icon === 'string' && patch.icon.trim()
          ? patch.icon.trim()
          : null;

    const res = await client.query<RawLabelRow>(
      `UPDATE photo_labels
          SET label = $3, color = $4, icon = $5, updated_at = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING ${LABEL_COLS}`,
      [id, orgId, nextLabel, nextColor, nextIcon],
    );
    return mapRow(res.rows[0]);
  });
}

/** Delete a custom label (cascades its assignments). System labels are guarded. */
export async function deleteLabel(
  orgId: OrgId,
  id: number,
  deps: LabelDeps = defaultDeps,
): Promise<void> {
  await deps.withTenantTransaction(orgId, async (client) => {
    const existing = await client.query<{ is_system: boolean }>(
      `SELECT is_system FROM photo_labels
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [id, orgId],
    );
    if (existing.rowCount === 0) throw new LabelNotFoundError('Label not found');
    if (existing.rows[0].is_system) {
      throw new LabelSystemGuardError('System labels cannot be deleted');
    }
    await client.query(
      `DELETE FROM photo_labels WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );
  });
}

/** The label ids currently assigned to a photo. */
export async function getPhotoLabelIds(
  orgId: OrgId,
  photoId: number,
  deps: LabelDeps = defaultDeps,
): Promise<number[]> {
  const res = await deps.tenantQuery<{ label_id: string | number }>(
    orgId,
    `SELECT label_id FROM photo_label_assignments
      WHERE photo_id = $1 AND organization_id = $2`,
    [photoId, orgId],
  );
  return res.rows.map((r) => Number(r.label_id));
}

/**
 * Replace a photo's label set with exactly `labelIds` (PUT semantics). Computes
 * the add/remove diff inside one transaction so the chip set is atomic. Only
 * label ids that actually belong to the org are inserted (a foreign id is
 * silently dropped, not an error). Returns the resulting label rows.
 */
export async function setPhotoLabels(
  orgId: OrgId,
  photoId: number,
  labelIds: number[],
  staffId: number | null,
  deps: LabelDeps = defaultDeps,
): Promise<PhotoLabel[]> {
  const wanted = Array.from(new Set(labelIds.filter((n) => Number.isFinite(n) && n > 0)));
  return deps.withTenantTransaction(orgId, async (client) => {
    // Confirm the photo exists in this org (avoids orphan assignments).
    const photo = await client.query(
      `SELECT 1 FROM photos WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [photoId, orgId],
    );
    if (photo.rowCount === 0) throw new LabelNotFoundError('Photo not found');

    // Constrain to labels that belong to this org.
    const valid =
      wanted.length === 0
        ? []
        : (
            await client.query<{ id: string | number }>(
              `SELECT id FROM photo_labels
                WHERE organization_id = $1 AND id = ANY($2::bigint[])`,
              [orgId, wanted],
            )
          ).rows.map((r) => Number(r.id));

    // Delete assignments no longer wanted.
    await client.query(
      `DELETE FROM photo_label_assignments
        WHERE photo_id = $1 AND organization_id = $2
          AND ($3::bigint[] = '{}' OR label_id <> ALL($3::bigint[]))`,
      [photoId, orgId, valid],
    );

    // Insert the missing ones (idempotent on the UNIQUE(photo_id,label_id)).
    if (valid.length > 0) {
      await client.query(
        `INSERT INTO photo_label_assignments
           (photo_id, label_id, organization_id, assigned_by_staff_id)
         SELECT $1, lid, $2, $4
           FROM unnest($3::bigint[]) AS lid
         ON CONFLICT (photo_id, label_id) DO NOTHING`,
        [photoId, orgId, valid, staffId],
      );
    }

    const res = await client.query<RawLabelRow>(
      `SELECT ${LABEL_COLS} FROM photo_labels
        WHERE organization_id = $1
          AND id IN (SELECT label_id FROM photo_label_assignments
                      WHERE photo_id = $2 AND organization_id = $1)
        ORDER BY sort_index, id`,
      [orgId, photoId],
    );
    return res.rows.map(mapRow);
  });
}

/**
 * Bulk add/remove labels across many photos (the selection-toolbar action).
 * Adds `addLabelIds` to every photo and removes `removeLabelIds` from every
 * photo, in one transaction. Returns the count of photos touched.
 */
export async function bulkApplyLabels(
  orgId: OrgId,
  photoIds: number[],
  addLabelIds: number[],
  removeLabelIds: number[],
  staffId: number | null,
  deps: LabelDeps = defaultDeps,
): Promise<{ photos: number }> {
  const photos = Array.from(new Set(photoIds.filter((n) => Number.isFinite(n) && n > 0)));
  const adds = Array.from(new Set(addLabelIds.filter((n) => Number.isFinite(n) && n > 0)));
  const removes = Array.from(new Set(removeLabelIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (photos.length === 0) return { photos: 0 };

  await deps.withTenantTransaction(orgId, async (client) => {
    if (removes.length > 0) {
      await client.query(
        `DELETE FROM photo_label_assignments
          WHERE organization_id = $1
            AND photo_id = ANY($2::bigint[])
            AND label_id = ANY($3::bigint[])`,
        [orgId, photos, removes],
      );
    }
    if (adds.length > 0) {
      // Cross-join the requested photos × org-owned labels; ON CONFLICT makes it idempotent.
      await client.query(
        `INSERT INTO photo_label_assignments
           (photo_id, label_id, organization_id, assigned_by_staff_id)
         SELECT pid, l.id, $1, $4
           FROM unnest($2::bigint[]) AS pid
           JOIN photo_labels l ON l.organization_id = $1 AND l.id = ANY($3::bigint[])
           JOIN photos p ON p.id = pid AND p.organization_id = $1
         ON CONFLICT (photo_id, label_id) DO NOTHING`,
        [orgId, photos, adds, staffId],
      );
    }
  });
  return { photos: photos.length };
}
