import { z } from 'zod';

// ─── Reusable building blocks ───────────────────────────────────────────────

const trimmed = z.string().trim();
/** Optional text that may be explicitly cleared with null. */
const optNullableText = trimmed.min(1).nullable().optional();

// ─── POST /api/sku-catalog ──────────────────────────────────────────────────

/**
 * Create a SKU catalog entry. `sku` + `productTitle` are required; the rest
 * are optional metadata. `idempotencyKey` lets a retried create replay the
 * original response instead of 409-ing on the natural unique key (`sku`).
 */
export const SkuCatalogCreateBody = z
  .object({
    sku: trimmed.min(1, 'sku is required'),
    productTitle: trimmed.min(1, 'productTitle is required'),
    category: optNullableText,
    upc: optNullableText,
    ean: optNullableText,
    imageUrl: optNullableText,
    isActive: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type SkuCatalogCreateInput = z.infer<typeof SkuCatalogCreateBody>;

// ─── PATCH /api/sku-catalog/[id] ────────────────────────────────────────────

/**
 * Partial update. `sku` is intentionally NOT editable here — it's the natural
 * key the rest of the system joins on; renames go through a dedicated flow.
 */
export const SkuCatalogUpdateBody = z
  .object({
    productTitle: trimmed.min(1).optional(),
    category: optNullableText,
    upc: optNullableText,
    ean: optNullableText,
    imageUrl: optNullableText,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

export type SkuCatalogUpdateInput = z.infer<typeof SkuCatalogUpdateBody>;
