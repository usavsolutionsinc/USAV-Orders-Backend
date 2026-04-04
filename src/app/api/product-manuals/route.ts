import { z } from 'zod';
import { createCrudHandler, ApiError } from '@/lib/api';
import {
  getAllProductManuals,
  getProductManualById,
  searchProductManuals,
  upsertProductManual,
  updateProductManual,
  deactivateProductManual,
  type ProductManual,
} from '@/lib/neon/product-manuals-queries';

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

  update: async (body) => updateProductManual(body),

  remove: async (id) => {
    const ok = await deactivateProductManual(Number(id));
    if (!ok) throw ApiError.notFound('product-manual', id);
    return { success: true as const };
  },
});

export const { GET, POST, PATCH, DELETE } = handler;
