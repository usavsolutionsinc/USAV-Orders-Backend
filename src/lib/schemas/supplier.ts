import { z } from 'zod';

// ─── Reusable building blocks (mirror sku-catalog.ts) ───────────────────────

const trimmed = z.string().trim();
/** Optional text that may be explicitly cleared with null. */
const optNullableText = trimmed.min(1).nullable().optional();
const optNullableInt = z.number().int().nonnegative().nullable().optional();

const supplierTypeEnum = z.enum([
  'ebay_seller',
  'distributor',
  'salvage',
  'oem',
  'marketplace',
  'other',
]);

// ─── POST /api/suppliers ─────────────────────────────────────────────────────

/**
 * Create a supplier (vendor) record. `name` is required; everything else is
 * optional metadata. `ebaySellerId` is the dedupe key for auto-created eBay
 * sellers — supplying it again replays/links the existing row. `idempotencyKey`
 * lets a retried create replay the original 201.
 */
export const SupplierCreateBody = z
  .object({
    name: trimmed.min(1, 'name is required'),
    supplierType: supplierTypeEnum.optional(),
    email: optNullableText,
    phone: optNullableText,
    url: optNullableText,
    ebaySellerId: optNullableText,
    /** Internal 1–5 trust score. */
    rating: z.number().int().gte(1).lte(5).nullable().optional(),
    leadTimeDays: optNullableInt,
    notes: optNullableText,
    isActive: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

// ─── PATCH /api/suppliers/[id] ───────────────────────────────────────────────

export const SupplierUpdateBody = z
  .object({
    name: trimmed.min(1).optional(),
    supplierType: supplierTypeEnum.optional(),
    email: optNullableText,
    phone: optNullableText,
    url: optNullableText,
    ebaySellerId: optNullableText,
    rating: z.number().int().gte(1).lte(5).nullable().optional(),
    leadTimeDays: optNullableInt,
    notes: optNullableText,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

export type SupplierCreateInput = z.infer<typeof SupplierCreateBody>;
export type SupplierUpdateInput = z.infer<typeof SupplierUpdateBody>;
