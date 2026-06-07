import { z } from 'zod';

const trimmed = z.string().trim();
const optNullableText = trimmed.min(1).nullable().optional();

const fitEnum = z.enum(['exact', 'equivalent', 'salvage']);
const confidenceEnum = z.enum(['confirmed', 'likely', 'unverified']);
const sourceEnum = z.enum(['manual', 'csv_import', 'ebay']);

// ─── POST /api/part-compatibility ───────────────────────────────────────────

/**
 * Create (upsert) a compatibility edge: this `skuId` part fits this
 * `boseModelId` in `partRole`. The DB enforces one edge per
 * (model, sku, role); a repeat POST updates the existing edge in place.
 */
export const PartCompatibilityCreateBody = z
  .object({
    boseModelId: z.number().int().positive(),
    skuId: z.number().int().positive(),
    partRole: trimmed.min(1, 'partRole is required'),
    isOem: z.boolean().optional(),
    fit: fitEnum.optional(),
    confidence: confidenceEnum.optional(),
    source: sourceEnum.optional(),
    notes: optNullableText,
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

// ─── PATCH /api/part-compatibility/[id] ─────────────────────────────────────

/**
 * Partial update of an edge's attributes. The (model, sku, role) identity is
 * fixed — to re-point an edge, delete and re-create it.
 */
export const PartCompatibilityUpdateBody = z
  .object({
    partRole: trimmed.min(1).optional(),
    isOem: z.boolean().optional(),
    fit: fitEnum.optional(),
    confidence: confidenceEnum.optional(),
    source: sourceEnum.optional(),
    notes: optNullableText,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

export type PartCompatibilityCreateInput = z.infer<typeof PartCompatibilityCreateBody>;
export type PartCompatibilityUpdateInput = z.infer<typeof PartCompatibilityUpdateBody>;
