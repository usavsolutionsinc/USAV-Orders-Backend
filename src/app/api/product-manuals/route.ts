import { z } from 'zod';
import { createCrudHandler, ApiError } from '@/lib/api';
import {
  getAllProductManuals,
  getProductManualById,
  searchProductManuals,
  upsertProductManual,
  deactivateProductManual,
  type ProductManual,
} from '@/lib/neon/product-manuals-queries';

const createManualSchema = z.object({
  sku: z.string().nullish(),
  itemNumber: z.string().nullish(),
  productTitle: z.string().nullish(),
  googleDocIdOrUrl: z.string().min(1, 'googleDocIdOrUrl is required'),
  type: z.string().nullish(),
}).refine(
  (d) => d.sku || d.itemNumber,
  { message: 'Either sku or itemNumber is required' },
);

const handler = createCrudHandler<ProductManual>({
  name: 'product-manuals',
  cacheNamespace: 'api:product-manuals',
  cacheTTL: 300,
  cacheTags: ['product-manuals'],

  createSchema: createManualSchema,

  list: async (params) => {
    const manuals = await getAllProductManuals({ limit: params.limit, offset: params.offset });
    return { rows: manuals };
  },

  getById: async (id) => getProductManualById(Number(id)),

  search: async (query, params) => searchProductManuals(query, params.limit),

  create: async (body) => upsertProductManual(body),

  remove: async (id) => {
    const ok = await deactivateProductManual(Number(id));
    if (!ok) throw ApiError.notFound('product-manual', id);
    return { success: true as const };
  },
});

export const { GET, POST, DELETE } = handler;
