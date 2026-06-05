import { z } from 'zod';

// ─── Reusable building blocks ───────────────────────────────────────────────

const positiveInt = z.number().int().positive();
/** Optional notes that may be explicitly cleared with null. */
const optNullableNotes = z.string().trim().min(1).nullable().optional();

// ─── POST /api/sku-catalog/graph/relationships ──────────────────────────────

/**
 * Create a directed parent→child edge between two sku_catalog ids. Both ids are
 * required; `qty` defaults to 1. `idempotencyKey` lets a retried create replay
 * the original response instead of colliding on the (parent, child) unique key.
 *
 * Business rules enforced in the route (not here): both SKUs must exist, no
 * self-edge, no duplicate, and no cycle (child must not already be an ancestor
 * of parent).
 */
export const SkuRelationshipCreateBody = z
  .object({
    parentSkuId: positiveInt,
    childSkuId: positiveInt,
    qty: positiveInt.optional(),
    notes: optNullableNotes,
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((b) => b.parentSkuId !== b.childSkuId, {
    message: 'A SKU cannot be its own parent or child',
    path: ['childSkuId'],
  });

export type SkuRelationshipCreateInput = z.infer<typeof SkuRelationshipCreateBody>;

// ─── PATCH /api/sku-catalog/graph/relationships/[id] ────────────────────────

/**
 * Partial update of an existing edge. Only `qty` and `notes` are mutable — the
 * parent/child endpoints of an edge are fixed; re-pointing means delete + add.
 */
export const SkuRelationshipUpdateBody = z
  .object({
    qty: positiveInt.optional(),
    notes: optNullableNotes,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

export type SkuRelationshipUpdateInput = z.infer<typeof SkuRelationshipUpdateBody>;
