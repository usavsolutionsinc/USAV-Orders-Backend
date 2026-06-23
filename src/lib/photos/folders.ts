/**
 * Photo library "master folders" — persistent, org-scoped, nestable folders the
 * operator creates by hand, plus the assignment join that places any photo
 * (`photos.id`) into a folder. A manual overlay on top of the derived
 * po_ref/ticket grouping (see `PhotoLibraryGrid`'s FoldersView).
 *
 * All queries run through `tenantQuery` / `withTenantTransaction` (SET LOCAL
 * app.current_org) AND keep an explicit `organization_id = $1` clause — belt and
 * suspenders, since RLS is inert while the app connects as a BYPASSRLS role.
 * Reached only through the `/api/photos/folders*` routes, which audit the writes.
 */
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface PhotoFolderRow {
  id: number;
  parentId: number | null;
  name: string;
  sortIndex: number;
  /** Photos directly assigned to this folder (not counting descendants). */
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RawFolderRow {
  id: string | number;
  parent_id: string | number | null;
  name: string;
  sort_index: number;
  photo_count: string | number;
  created_at: string;
  updated_at: string;
}

function mapFolder(row: RawFolderRow): PhotoFolderRow {
  return {
    id: Number(row.id),
    parentId: row.parent_id != null ? Number(row.parent_id) : null,
    name: row.name,
    sortIndex: Number(row.sort_index),
    photoCount: Number(row.photo_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `
  f.id, f.parent_id, f.name, f.sort_index, f.created_at, f.updated_at,
  (SELECT COUNT(*) FROM photo_folder_items i
    WHERE i.folder_id = f.id AND i.organization_id = f.organization_id) AS photo_count`;

/** Every folder for an org, ordered for a stable tree build (parent, sort, id). */
export async function listFolders(orgId: OrgId): Promise<PhotoFolderRow[]> {
  const res = await tenantQuery<RawFolderRow>(
    orgId,
    `SELECT ${SELECT_COLS}
       FROM photo_folders f
      WHERE f.organization_id = $1
      ORDER BY COALESCE(f.parent_id, 0), f.sort_index, f.id`,
    [orgId],
  );
  return res.rows.map(mapFolder);
}

async function getFolderById(orgId: OrgId, id: number): Promise<PhotoFolderRow | null> {
  const res = await tenantQuery<RawFolderRow>(
    orgId,
    `SELECT ${SELECT_COLS} FROM photo_folders f
      WHERE f.organization_id = $1 AND f.id = $2`,
    [orgId, id],
  );
  return res.rows[0] ? mapFolder(res.rows[0]) : null;
}

export class FolderConflictError extends Error {}
export class FolderCycleError extends Error {}

/** Create a folder. `sortIndex` defaults to the end of its parent's list. */
export async function createFolder(
  orgId: OrgId,
  input: { name: string; parentId?: number | null; sortIndex?: number | null },
): Promise<PhotoFolderRow> {
  const parentId = input.parentId ?? null;
  try {
    const res = await withTenantTransaction(orgId, (c) =>
      c.query<RawFolderRow>(
        `WITH ins AS (
           INSERT INTO photo_folders (organization_id, parent_id, name, sort_index)
           VALUES (
             $1, $2, $3,
             COALESCE($4::int, (
               SELECT COALESCE(MAX(sort_index) + 1, 0) FROM photo_folders
                WHERE organization_id = $1 AND COALESCE(parent_id, 0) = COALESCE($2::bigint, 0)
             ))
           )
           RETURNING id, parent_id, name, sort_index, created_at, updated_at
         )
         SELECT ins.*, 0 AS photo_count FROM ins`,
        [orgId, parentId, input.name.trim(), input.sortIndex ?? null],
      ),
    );
    return mapFolder(res.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new FolderConflictError('A folder with that name already exists here');
    }
    throw err;
  }
}

/** Rename a folder. Returns null if it doesn't exist in this org. */
export async function renameFolder(
  orgId: OrgId,
  id: number,
  name: string,
): Promise<PhotoFolderRow | null> {
  try {
    const res = await tenantQuery<RawFolderRow>(
      orgId,
      `WITH upd AS (
         UPDATE photo_folders SET name = $3, updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING id, parent_id, name, sort_index, created_at, updated_at
       )
       SELECT upd.*, (SELECT COUNT(*) FROM photo_folder_items i
                       WHERE i.folder_id = upd.id AND i.organization_id = $1) AS photo_count
         FROM upd`,
      [orgId, id, name.trim()],
    );
    return res.rows[0] ? mapFolder(res.rows[0]) : null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new FolderConflictError('A folder with that name already exists here');
    }
    throw err;
  }
}

/** True if `candidateParent` is the folder itself or one of its descendants. */
async function wouldCycle(orgId: OrgId, id: number, candidateParent: number): Promise<boolean> {
  if (candidateParent === id) return true;
  const res = await tenantQuery<{ id: string | number }>(
    orgId,
    `WITH RECURSIVE descendants AS (
       SELECT id FROM photo_folders WHERE organization_id = $1 AND id = $2
       UNION ALL
       SELECT f.id FROM photo_folders f
         JOIN descendants d ON f.parent_id = d.id
        WHERE f.organization_id = $1
     )
     SELECT id FROM descendants WHERE id = $3`,
    [orgId, id, candidateParent],
  );
  return res.rows.length > 0;
}

/** Move/reparent and/or reorder a single folder. */
export async function moveFolder(
  orgId: OrgId,
  id: number,
  input: { parentId?: number | null; sortIndex?: number | null },
): Promise<PhotoFolderRow | null> {
  const existing = await getFolderById(orgId, id);
  if (!existing) return null;
  const nextParent = input.parentId === undefined ? existing.parentId : input.parentId;
  if (nextParent != null && (await wouldCycle(orgId, id, nextParent))) {
    throw new FolderCycleError('Cannot move a folder into itself or one of its subfolders');
  }
  const nextSort = input.sortIndex ?? existing.sortIndex;
  try {
    const res = await tenantQuery<RawFolderRow>(
      orgId,
      `WITH upd AS (
         UPDATE photo_folders SET parent_id = $3, sort_index = $4, updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING id, parent_id, name, sort_index, created_at, updated_at
       )
       SELECT upd.*, (SELECT COUNT(*) FROM photo_folder_items i
                       WHERE i.folder_id = upd.id AND i.organization_id = $1) AS photo_count
         FROM upd`,
      [orgId, id, nextParent, nextSort],
    );
    return res.rows[0] ? mapFolder(res.rows[0]) : null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new FolderConflictError('A folder with that name already exists at the destination');
    }
    throw err;
  }
}

/** Persist a new sort order for a set of sibling folders. */
export async function reorderFolders(
  orgId: OrgId,
  items: Array<{ id: number; sortIndex: number }>,
): Promise<void> {
  if (items.length === 0) return;
  await withTenantTransaction(orgId, async (c) => {
    for (const it of items) {
      await c.query(
        `UPDATE photo_folders SET sort_index = $3, updated_at = now()
          WHERE organization_id = $1 AND id = $2`,
        [orgId, it.id, it.sortIndex],
      );
    }
  });
}

/** Delete a folder. Children + assignments cascade (FK ON DELETE CASCADE). */
export async function deleteFolder(orgId: OrgId, id: number): Promise<boolean> {
  const res = await tenantQuery(
    orgId,
    `DELETE FROM photo_folders WHERE organization_id = $1 AND id = $2`,
    [orgId, id],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Assign photos to a folder (idempotent). Only photos that belong to the org are
 * inserted (the SELECT filters by `photos.organization_id`), so a cross-tenant
 * id is silently ignored rather than leaking. Returns how many rows were added.
 */
export async function addPhotosToFolder(
  orgId: OrgId,
  folderId: number,
  photoIds: number[],
): Promise<{ folderExists: boolean; added: number }> {
  if (photoIds.length === 0) return { folderExists: true, added: 0 };
  return withTenantTransaction(orgId, async (c) => {
    const folder = await c.query(
      `SELECT 1 FROM photo_folders WHERE organization_id = $1 AND id = $2`,
      [orgId, folderId],
    );
    if (folder.rowCount === 0) return { folderExists: false, added: 0 };
    const res = await c.query(
      `INSERT INTO photo_folder_items (organization_id, folder_id, photo_id)
       SELECT $1, $2, p.id FROM photos p
        WHERE p.id = ANY($3::bigint[]) AND p.organization_id = $1
       ON CONFLICT (organization_id, folder_id, photo_id) DO NOTHING`,
      [orgId, folderId, photoIds],
    );
    return { folderExists: true, added: res.rowCount ?? 0 };
  });
}

/** Remove photos from a folder. Returns how many assignments were removed. */
export async function removePhotosFromFolder(
  orgId: OrgId,
  folderId: number,
  photoIds: number[],
): Promise<number> {
  if (photoIds.length === 0) return 0;
  const res = await tenantQuery(
    orgId,
    `DELETE FROM photo_folder_items
      WHERE organization_id = $1 AND folder_id = $2 AND photo_id = ANY($3::bigint[])`,
    [orgId, folderId, photoIds],
  );
  return res.rowCount ?? 0;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '23505' || /unique/i.test((err as { message?: string } | null)?.message ?? '');
}
