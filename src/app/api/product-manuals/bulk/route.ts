import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';

/**
 * POST /api/product-manuals/bulk
 *
 * One endpoint, three actions — keeps the surface small and the bulk-action
 * UX (multi-select toolbar) wired to a single call site.
 *
 * Body:
 *   {
 *     action: 'move' | 'update' | 'delete',
 *     ids: number[],
 *     // for 'move':
 *     folderPath?: string,
 *     // for 'update' (per-field optional; null clears, undefined preserves):
 *     type?: string | null,
 *     status?: 'unassigned' | 'assigned' | 'archived',
 *   }
 *
 * Why one endpoint instead of three: bulk UX is a single "do this to the
 * selection" gesture; routing splits the burden of writing/maintaining three
 * almost-identical handlers (auth, validation, cache invalidation, error
 * shape). The action param picks which SQL fires.
 *
 * Why soft-delete here too (matches DELETE on the main route): operator
 * confidence via the bulk-undo toast. The blob bytes stay on disk; only
 * `is_active` flips. A separate trash-cleanup job can hard-delete later.
 *
 * Returns the updated row count so the caller can show "Moved 12 manuals
 * to Sound/Touch" in the success toast.
 */

interface BulkBody {
  action?: 'move' | 'update' | 'delete';
  ids?: unknown;
  folderPath?: string | null;
  type?: string | null;
  status?: 'unassigned' | 'assigned' | 'archived';
}

function parseIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId;
    let body: BulkBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 });
    }

    const ids = parseIds(body.ids);
    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids required' }, { status: 400 });
    }
    if (ids.length > 1000) {
      return NextResponse.json({ success: false, error: 'max 1000 ids per call' }, { status: 400 });
    }

    const action = body.action;
    try {
      if (action === 'move') {
        const folderPath = String(body.folderPath || '').trim().replace(/^\/+|\/+$/g, '');
        // Empty string is meaningful — moves the selection to the root.
        // product_manuals has NO organization_id column and NO RLS policy, so a
        // bare GUC wrap provides ZERO isolation — org A could move org B's
        // manuals by guessing ids. Scope the mutation through the org-bearing
        // sku_catalog parent (sku_catalog_id → sku_catalog.organization_id),
        // matching the upsert lookup pattern in lib/product-manuals.ts.
        // NEEDS-COL: NULL-parent (unpaired) manuals are unattributable to any
        // org and are intentionally excluded until product_manuals gains its
        // own organization_id column.
        const result = await withTenantTransaction(orgId, (client) =>
          client.query(
            `UPDATE product_manuals
                SET folder_path = $1, updated_at = NOW()
              WHERE id = ANY($2::bigint[])
                AND is_active = TRUE
                AND sku_catalog_id IN (
                  SELECT id FROM sku_catalog WHERE organization_id = $3
                )`,
            [folderPath || null, ids, orgId],
          ),
        );
        return NextResponse.json({
          success: true,
          action: 'move',
          folderPath: folderPath || null,
          updated: result.rowCount ?? 0,
        });
      }

      if (action === 'update') {
        // Build a dynamic SET so callers only pay for fields they actually
        // wanted to change. Each clause uses COALESCE so the existing value
        // is preserved when the caller omits that field.
        const sets: string[] = [];
        const params: unknown[] = [];

        if (Object.prototype.hasOwnProperty.call(body, 'type')) {
          params.push(body.type || null);
          sets.push(`type = $${params.length}`);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
          const status = body.status;
          if (status !== 'unassigned' && status !== 'assigned' && status !== 'archived') {
            return NextResponse.json({ success: false, error: 'invalid status' }, { status: 400 });
          }
          params.push(status);
          sets.push(`status = $${params.length}`);
        }

        if (sets.length === 0) {
          return NextResponse.json(
            { success: false, error: 'no updatable fields provided' },
            { status: 400 },
          );
        }

        params.push(ids);
        const idsParam = params.length;
        params.push(orgId);
        const orgParam = params.length;
        // product_manuals has NO organization_id column and NO RLS policy — a
        // bare GUC wrap provides ZERO isolation. Scope through the org-bearing
        // sku_catalog parent so org A can't retag org B's manuals by id.
        // NEEDS-COL: NULL-parent manuals are excluded (see 'move' above).
        const result = await withTenantTransaction(orgId, (client) =>
          client.query(
            `UPDATE product_manuals
                SET ${sets.join(', ')}, updated_at = NOW()
              WHERE id = ANY($${idsParam}::bigint[])
                AND is_active = TRUE
                AND sku_catalog_id IN (
                  SELECT id FROM sku_catalog WHERE organization_id = $${orgParam}
                )`,
            params,
          ),
        );
        return NextResponse.json({
          success: true,
          action: 'update',
          updated: result.rowCount ?? 0,
        });
      }

      if (action === 'delete') {
        // Soft-delete by default — the operator's bulk-undo toast restores
        // via PATCH isActive=true on each id. Blob bytes stay on disk so
        // the toast can revert without re-uploading.
        // product_manuals has NO organization_id column and NO RLS policy — a
        // bare GUC wrap provides ZERO isolation. Scope through the org-bearing
        // sku_catalog parent so org A can't soft-delete org B's manuals by id.
        // NEEDS-COL: NULL-parent manuals are excluded (see 'move' above).
        const result = await withTenantTransaction(orgId, (client) =>
          client.query(
            `UPDATE product_manuals
                SET is_active = FALSE, updated_at = NOW()
              WHERE id = ANY($1::bigint[])
                AND is_active = TRUE
                AND sku_catalog_id IN (
                  SELECT id FROM sku_catalog WHERE organization_id = $2
                )`,
            [ids, orgId],
          ),
        );
        return NextResponse.json({
          success: true,
          action: 'delete',
          updated: result.rowCount ?? 0,
        });
      }

      return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'bulk operation failed';
      console.error('[product-manuals/bulk] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'product_manuals.manage' },
);

// Suppress unused import warning until a hard-delete action variant is added.
void del;
