import { z } from 'zod';

/**
 * Validation for the kit-parts ("what's in the box" / BOM) authoring endpoints.
 * Single source of truth shared by:
 *   - /api/sku-catalog/[id]/kit-parts  (catalog authoring CRUD)
 *
 * Mirrors the qc-checks authoring schema (src/lib/schemas/qc-checks.ts) — kit
 * parts are the sibling per-SKU template that drives the packer's pack-time
 * checklist (see docs/packing-checklist-plan.md). The data is read at pack time
 * by /api/get-title-by-sku and rendered by <PackChecklist>.
 */

const trimmed = z.string().trim();

/** Component kind — drives the row tag in the packer checklist. Free text is
 *  accepted (max 40) so a tenant can coin its own, but these are the defaults. */
export const KIT_PART_TYPES = [
  'PART',
  'ACCESSORY',
  'CABLE',
  'ADAPTER',
  'REMOTE',
  'MANUAL',
  'PACKAGING',
] as const;
export type KitPartType = (typeof KIT_PART_TYPES)[number];

/** Fields shared by create + update (all optional on both — create defaults
 *  them server-side, update treats absent as "leave unchanged"). */
const sharedFields = {
  componentType: trimmed.max(40).optional(),
  qtyRequired: z.number().int().min(1).max(999).optional(),
  /** Condition grades this part is required for (e.g. ['REFURBISHED']). Empty/
   *  null ⇒ required for ALL conditions (the common case). */
  requiredFor: z.array(trimmed.min(1)).nullish(),
  /** Critical parts drive the "all required items in the box" pack signal. */
  isCritical: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
};

export const KitPartCreateBody = z.object({
  componentName: trimmed.min(1, 'componentName is required').max(200),
  ...sharedFields,
  idempotencyKey: trimmed.max(120).optional(),
});
export type KitPartCreateInput = z.infer<typeof KitPartCreateBody>;

export const KitPartUpdateBody = z.object({
  partId: z.coerce.number().int().positive(),
  componentName: trimmed.min(1).max(200).optional(),
  ...sharedFields,
});
export type KitPartUpdateInput = z.infer<typeof KitPartUpdateBody>;

export const KitPartDeleteBody = z.object({
  partId: z.coerce.number().int().positive(),
});
