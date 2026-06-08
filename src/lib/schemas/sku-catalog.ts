import { z } from 'zod';

// ─── Reusable building blocks ───────────────────────────────────────────────

const trimmed = z.string().trim();
/** Optional text that may be explicitly cleared with null. */
const optNullableText = trimmed.min(1).nullable().optional();

/** Sourcing lifecycle signal shared by create + update bodies (Bose engine). */
const lifecycleStatusEnum = z.enum(['active', 'eol', 'discontinued', 'nrnd', 'unknown']);
const optNonNegInt = z.number().int().nonnegative().nullable().optional();

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
    // ─ Sourcing lifecycle (Bose engine opt-in; additive, all optional) ─
    lifecycleStatus: lifecycleStatusEnum.optional(),
    reorderThreshold: optNonNegInt,
    lastKnownCostCents: optNonNegInt,
    sourcingNotes: optNullableText,
    replenishTargetCents: optNonNegInt,
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

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
    // ─ Sourcing lifecycle (Bose engine opt-in; additive, all optional) ─
    lifecycleStatus: lifecycleStatusEnum.optional(),
    reorderThreshold: optNonNegInt,
    lastKnownCostCents: optNonNegInt,
    sourcingNotes: optNullableText,
    replenishTargetCents: optNonNegInt,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });
