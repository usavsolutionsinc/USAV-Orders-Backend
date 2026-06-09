import { z } from 'zod';

// ─── Reusable building blocks ───────────────────────────────────────────────

const positiveInt = z.number().int().positive();
const optNullableNotes = z.string().trim().min(1).nullable().optional();

/** Operator-supplied unit references — accepts ids, `U-{id}`, unit_uid, serial. */
const unitRefs = z
  .array(z.union([z.string().trim().min(1), positiveInt]))
  .min(1, 'At least one unit reference is required')
  .max(500, 'Too many units in one request')
  .transform((arr) => arr.map((v) => String(v)));

// ─── POST /api/handling-units ───────────────────────────────────────────────

/**
 * Mint a handling unit (box/tray). Code is auto-minted `H-{id}` server-side
 * unless an external tote `code` is supplied (Option C). Optional `units` seeds
 * the box at creation (re-sort-into-a-fresh-box flow). `idempotencyKey` lets a
 * retried mint replay the original response instead of creating a second box.
 */
export const HandlingUnitCreateBody = z
  .object({
    code: z.string().trim().min(1).max(64).nullable().optional(),
    locationId: positiveInt.nullable().optional(),
    notes: optNullableNotes,
    units: unitRefs.optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type HandlingUnitCreateInput = z.infer<typeof HandlingUnitCreateBody>;

// ─── POST /api/handling-units/[id]/assign ───────────────────────────────────

/** Add units to a box. */
export const HandlingUnitAssignBody = z
  .object({
    units: unitRefs,
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type HandlingUnitAssignInput = z.infer<typeof HandlingUnitAssignBody>;

// ─── POST /api/handling-units/[id]/unassign ─────────────────────────────────

/** Remove units from a box (their handling_unit_id → NULL). */
export const HandlingUnitUnassignBody = z
  .object({
    units: unitRefs,
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type HandlingUnitUnassignInput = z.infer<typeof HandlingUnitUnassignBody>;
