import { z } from 'zod';
import { put, del } from '@vercel/blob';
import { createCrudHandler, ApiError } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getAllProductManuals,
  getProductManualById,
  searchProductManuals,
  upsertProductManual,
  updateProductManual,
  deactivateProductManual,
  type ProductManual,
} from '@/lib/neon/product-manuals-queries';

/**
 * Vercel Blob URLs all sit under a `*.public.blob.vercel-storage.com` host
 * (or `blob.vercel-storage.com` in some deployments). We only attempt blob
 * renames on URLs we recognize as ours — third-party `source_url`s (Google
 * Doc shares, customer-portal links) stay untouched.
 */
function isVercelBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.blob.vercel-storage.com') || host === 'blob.vercel-storage.com';
  } catch {
    return false;
  }
}

/**
 * Filesystem-safe slug derived from the display name. Used as the blob key
 * suffix so the Blob URL itself reflects the manual's current name (and the
 * browser's "Save as…" picks up the right filename without us doing anything
 * on the client). Empty input → 'manual'.
 */
function blobSlug(displayName: string): string {
  const cleaned = displayName
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/[/\\]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80);
  return cleaned || 'manual';
}

function extractExtension(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const m = path.match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : 'pdf';
}

/**
 * Copy a Vercel Blob to a new key whose name embeds `displayName`, then
 * delete the original. Returns the new public URL. Best-effort: any
 * network/blob failure falls back to leaving source_url untouched (caller
 * passes the original URL through). The metadata row update never depends
 * on the rename succeeding.
 */
async function renameBlobForDisplayName(
  sourceUrl: string,
  displayName: string,
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'application/pdf';
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = extractExtension(sourceUrl);
    const newKey = `product-manuals/${Date.now()}_${blobSlug(displayName)}.${ext}`;
    const uploaded = await put(newKey, buffer, { access: 'public', contentType });
    // Old blob removal is best-effort — a stale blob is harmless once the
    // DB row points at the new URL.
    try { await del(sourceUrl); } catch { /* ignore */ }
    return uploaded.url;
  } catch (err) {
    console.warn('[product-manuals] blob rename failed; keeping original URL:', err);
    return null;
  }
}

const createManualSchema = z.object({
  sku: z.string().nullish(),
  itemNumber: z.string().nullish(),
  productTitle: z.string().nullish(),
  displayName: z.string().nullish(),
  googleDocIdOrUrl: z.string().nullish(),
  sourceUrl: z.string().nullish(),
  relativePath: z.string().nullish(),
  folderPath: z.string().nullish(),
  fileName: z.string().nullish(),
  status: z.enum(['unassigned', 'assigned', 'archived']).nullish(),
  assignedBy: z.string().nullish(),
  type: z.string().nullish(),
}).refine(
  (value) => Boolean(String(value.googleDocIdOrUrl || '').trim() || String(value.relativePath || '').trim()),
  'googleDocIdOrUrl or relativePath is required',
);

const updateManualSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(Number),
  sku: z.string().nullish(),
  itemNumber: z.string().nullish(),
  productTitle: z.string().nullish(),
  displayName: z.string().nullish(),
  googleDocIdOrUrl: z.string().nullish(),
  sourceUrl: z.string().nullish(),
  relativePath: z.string().nullish(),
  folderPath: z.string().nullish(),
  fileName: z.string().nullish(),
  status: z.enum(['unassigned', 'assigned', 'archived']).nullish(),
  assignedBy: z.string().nullish(),
  type: z.string().nullish(),
  isActive: z.boolean().nullish(),
});

const handler = createCrudHandler<ProductManual>({
  name: 'product-manuals',
  cacheNamespace: 'api:product-manuals',
  cacheTTL: 300,
  cacheTags: ['product-manuals'],

  createSchema: createManualSchema,
  updateSchema: updateManualSchema,

  list: async (params) => {
    const status = params.searchParams.get('status');
    const itemNumber = params.searchParams.get('itemNumber');
    const relativePath = params.searchParams.get('relativePath');
    const manuals = await getAllProductManuals({
      limit: params.limit,
      offset: params.offset,
      status: status === 'unassigned' || status === 'assigned' || status === 'archived' ? status : null,
      itemNumber: itemNumber ? itemNumber : null,
      relativePath: relativePath ? relativePath : null,
    });
    return { rows: manuals };
  },

  getById: async (id) => getProductManualById(Number(id)),

  search: async (query, params) => {
    const status = params.searchParams.get('status');
    return searchProductManuals(
      query,
      params.limit,
      status === 'unassigned' || status === 'assigned' || status === 'archived' ? status : null,
    );
  },

  create: async (body) => upsertProductManual(body),

  /**
   * On display-name change, also rename the underlying Vercel Blob so the
   * URL (and therefore the browser's Save-As suggestion + the iframe key)
   * reflects the new name. Pure-metadata edits on non-blob sources skip
   * the rename and act like the bare `updateProductManual` call.
   */
  update: async (body) => {
    const nextDisplayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';

    if (nextDisplayName) {
      const existing = await getProductManualById(Number(body.id));
      const oldUrl = existing?.source_url;
      const oldName = (existing?.display_name || '').trim();
      const needsRename =
        existing
        && nextDisplayName !== oldName
        && isVercelBlobUrl(oldUrl)
        && blobSlug(nextDisplayName) !== blobSlug(oldName);

      if (needsRename && oldUrl) {
        const newUrl = await renameBlobForDisplayName(oldUrl, nextDisplayName);
        if (newUrl) body = { ...body, sourceUrl: newUrl };
      }
    }

    return updateProductManual(body);
  },

  remove: async (id) => {
    const ok = await deactivateProductManual(Number(id));
    if (!ok) throw ApiError.notFound('product-manual', id);
    return { success: true as const };
  },
});

// Gate every method — the bare `export const { ... } = handler` left these
// ungated (and invisible to the route-permission audit). Reads need catalog
// view; writes need product_manuals.manage, matching the sibling routes
// (assign/bulk/upsert/sync/upload).
export const GET = withAuth(handler.GET as any, { permission: 'sku_stock.view' });
export const POST = withAuth(handler.POST as any, { permission: 'product_manuals.manage' });
export const PATCH = withAuth(handler.PATCH as any, { permission: 'product_manuals.manage' });
export const DELETE = withAuth(handler.DELETE as any, { permission: 'product_manuals.manage' });
