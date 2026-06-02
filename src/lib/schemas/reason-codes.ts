import { z } from 'zod';

const trimmed = z.string().trim();
const direction = z.enum(['in', 'out', 'either']);

/**
 * Allowed categories — must match the `reason_codes_category_chk` DB CHECK
 * (see 2026-05-14_reason_codes.sql). Validating here turns a would-be 500
 * (constraint violation) into a clean 400.
 */
export const REASON_CODE_CATEGORIES = [
  'shrinkage',
  'adjustment',
  'sale',
  'return',
  'movement',
  'initial',
] as const;
const category = z.enum(REASON_CODE_CATEGORIES);

// ─── POST /api/reason-codes ─────────────────────────────────────────────────

export const ReasonCodeCreateBody = z
  .object({
    code: trimmed.min(1, 'code is required').max(64),
    label: trimmed.min(1, 'label is required').max(200),
    category,
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
    category: category.optional(),
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
