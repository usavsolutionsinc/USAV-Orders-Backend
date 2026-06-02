import { z } from 'zod';

const trimmed = z.string().trim();
const direction = z.enum(['in', 'out', 'either']);

// ─── POST /api/reason-codes ─────────────────────────────────────────────────

export const ReasonCodeCreateBody = z
  .object({
    code: trimmed.min(1, 'code is required').max(64),
    label: trimmed.min(1, 'label is required').max(200),
    category: trimmed.min(1, 'category is required').max(64),
    direction: direction.optional(),
    requiresNote: z.boolean().optional(),
    requiresPhoto: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type ReasonCodeCreateInput = z.infer<typeof ReasonCodeCreateBody>;

// ─── PATCH /api/reason-codes/[id] ───────────────────────────────────────────

/** `code` is the natural key and is not editable here. */
export const ReasonCodeUpdateBody = z
  .object({
    label: trimmed.min(1).max(200).optional(),
    category: trimmed.min(1).max(64).optional(),
    direction: direction.optional(),
    requiresNote: z.boolean().optional(),
    requiresPhoto: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

export type ReasonCodeUpdateInput = z.infer<typeof ReasonCodeUpdateBody>;
