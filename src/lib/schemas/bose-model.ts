import { z } from 'zod';

// ─── Reusable building blocks (mirror sku-catalog.ts) ───────────────────────

const trimmed = z.string().trim();
/** Optional text that may be explicitly cleared with null. */
const optNullableText = trimmed.min(1).nullable().optional();
const optYear = z.number().int().gte(1950).lte(2100).nullable().optional();

// ─── POST /api/bose-models ──────────────────────────────────────────────────

/**
 * Create a Bose model catalog entry. `modelNumber` + `modelName` are required;
 * `modelNumber` is the natural unique key. `idempotencyKey` lets a retried
 * create replay the original 201 instead of 409-ing on the unique key.
 */
export const BoseModelCreateBody = z
  .object({
    modelNumber: trimmed.min(1, 'modelNumber is required'),
    modelName: trimmed.min(1, 'modelName is required'),
    family: optNullableText,
    productType: optNullableText,
    releaseYear: optYear,
    /** ISO date (YYYY-MM-DD) Bose discontinued the line. */
    eolDate: trimmed.regex(/^\d{4}-\d{2}-\d{2}$/, 'eolDate must be YYYY-MM-DD').nullable().optional(),
    imageUrl: optNullableText,
    notes: optNullableText,
    isActive: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

// ─── PATCH /api/bose-models/[id] ────────────────────────────────────────────

/**
 * Partial update. `modelNumber` is intentionally NOT editable here — it's the
 * natural key compatibility + serial-decode rows join on.
 */
export const BoseModelUpdateBody = z
  .object({
    modelName: trimmed.min(1).optional(),
    family: optNullableText,
    productType: optNullableText,
    releaseYear: optYear,
    eolDate: trimmed.regex(/^\d{4}-\d{2}-\d{2}$/, 'eolDate must be YYYY-MM-DD').nullable().optional(),
    imageUrl: optNullableText,
    notes: optNullableText,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

export type BoseModelCreateInput = z.infer<typeof BoseModelCreateBody>;
export type BoseModelUpdateInput = z.infer<typeof BoseModelUpdateBody>;
