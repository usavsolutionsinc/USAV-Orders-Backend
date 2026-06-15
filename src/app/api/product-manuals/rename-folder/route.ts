import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';

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
  async (request, ctx) => {
    const orgId = ctx.organizationId;
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

    try {
      // product_manuals has NO organization_id column and NO RLS policy, so a
      // bare GUC wrap provides ZERO isolation — folder_path strings are not
      // org-namespaced, so org A renaming 'Sound/Touch' would rewrite EVERY
      // tenant's matching rows. Scope both UPDATEs through the org-bearing
      // sku_catalog parent (sku_catalog_id → sku_catalog.organization_id).
      // NEEDS-COL: NULL-parent (unpaired) manuals are unattributable to any
      // org and are intentionally excluded until product_manuals gains its
      // own organization_id column.
      const { exact, descendants } = await withTenantTransaction(orgId, async (client) => {
        const exact = await client.query(
          `UPDATE product_manuals
              SET folder_path = $2, updated_at = NOW()
            WHERE is_active = TRUE
              AND folder_path = $1
              AND sku_catalog_id IN (
                SELECT id FROM sku_catalog WHERE organization_id = $3
              )`,
          [oldPath, newPath, orgId],
        );

        // Substring trick: keep everything after the matched prefix length.
        // PostgreSQL SUBSTRING is 1-indexed, so we start at LENGTH(oldPath)+1
        // to skip the prefix itself (not the trailing slash).
        const descendants = await client.query(
          `UPDATE product_manuals
              SET folder_path = $2 || SUBSTRING(folder_path FROM ${oldPath.length + 1}),
                  updated_at = NOW()
            WHERE is_active = TRUE
              AND folder_path LIKE $1 || '/%'
              AND sku_catalog_id IN (
                SELECT id FROM sku_catalog WHERE organization_id = $3
              )`,
          [oldPath, newPath, orgId],
        );

        return { exact, descendants };
      });

      return NextResponse.json({
        success: true,
        oldPath,
        newPath,
        updated: (exact.rowCount ?? 0) + (descendants.rowCount ?? 0),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'rename failed';
      console.error('[product-manuals/rename-folder] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'product_manuals.manage' },
);
