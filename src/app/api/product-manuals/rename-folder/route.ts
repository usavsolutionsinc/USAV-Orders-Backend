import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * POST /api/product-manuals/rename-folder
 *
 * Folders are derived from the `folder_path` string on each row — there's no
 * folders table. So renaming or moving a folder = rewriting that prefix on
 * every row inside it (and its descendants).
 *
 * Body: { oldPath: 'Sound/Touch', newPath: 'Audio/Touch' }
 *
 * Two batched updates in a transaction:
 *   1. exact-match rows (`folder_path = oldPath`) → set to newPath
 *   2. descendant rows (`folder_path LIKE oldPath || '/%'`) → replace the
 *      prefix, preserve the rest of the path
 *
 * Why a single SQL helper instead of pulling rows + rewriting in JS: the
 * library can have thousands of files in a deep folder and we don't want
 * to round-trip each row. Both UPDATEs are parameterized so caller-supplied
 * paths can't break out of the query.
 *
 * Returns the number of rows touched so the UI can show a toast.
 */
export const POST = withAuth(
  async (request) => {
    let body: { oldPath?: string; newPath?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 });
    }

    const oldPath = String(body?.oldPath || '').trim().replace(/^\/+|\/+$/g, '');
    const newPath = String(body?.newPath || '').trim().replace(/^\/+|\/+$/g, '');

    if (!oldPath) {
      return NextResponse.json({ success: false, error: 'oldPath is required' }, { status: 400 });
    }
    if (!newPath) {
      return NextResponse.json({ success: false, error: 'newPath is required' }, { status: 400 });
    }
    if (oldPath === newPath) {
      return NextResponse.json({ success: true, updated: 0, oldPath, newPath });
    }
    // Block moving a folder into itself — would create a path like
    // Sound/Touch → Sound/Touch/Touch which is almost never the intent.
    if (newPath === oldPath || newPath.startsWith(`${oldPath}/`)) {
      return NextResponse.json(
        { success: false, error: 'cannot move a folder into itself' },
        { status: 400 },
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const exact = await client.query(
        `UPDATE product_manuals
            SET folder_path = $2, updated_at = NOW()
          WHERE is_active = TRUE
            AND folder_path = $1`,
        [oldPath, newPath],
      );

      // Substring trick: keep everything after the matched prefix length.
      // PostgreSQL SUBSTRING is 1-indexed, so we start at LENGTH(oldPath)+1
      // to skip the prefix itself (not the trailing slash).
      const descendants = await client.query(
        `UPDATE product_manuals
            SET folder_path = $2 || SUBSTRING(folder_path FROM ${oldPath.length + 1}),
                updated_at = NOW()
          WHERE is_active = TRUE
            AND folder_path LIKE $1 || '/%'`,
        [oldPath, newPath],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        oldPath,
        newPath,
        updated: (exact.rowCount ?? 0) + (descendants.rowCount ?? 0),
      });
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const message = err instanceof Error ? err.message : 'rename failed';
      console.error('[product-manuals/rename-folder] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    } finally {
      client.release();
    }
  },
  { permission: 'product_manuals.manage' },
);
