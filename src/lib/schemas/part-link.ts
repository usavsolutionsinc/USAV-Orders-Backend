import { z } from 'zod';

const optNullableNotes = z.string().trim().min(1).nullable().optional();
const uuid = z.string().uuid();
const logicalKey = z.string().trim().min(1);
const base = z.string().trim().min(1);

// ─── POST /api/inventory/parts/links ────────────────────────────────────────

/**
 * Assign a whole-unit parent to a logical part. The child is identified by its
 * canonical logical key (base + color + condition; from parsePartSku), NOT by a
 * volatile per-instance SKU row. `parentItemId` is an `items.id` (the Zoho items
 * scheme) — validated in the route to belong to this org.
 */
export const PartLinkCreateBody = z
  .object({
    childLogicalKey: logicalKey,
    childBase: base,
    parentItemId: uuid,
    qty: z.number().int().positive().optional(),
    notes: optNullableNotes,
  })
  .strict();

// ─── POST /api/inventory/parts/links/not-a-part ─────────────────────────────

/** Acknowledge that a `-P` logical part is not actually a part. */
export const PartLinkNotAPartBody = z
  .object({
    childLogicalKey: logicalKey,
    childBase: base,
  })
  .strict();
