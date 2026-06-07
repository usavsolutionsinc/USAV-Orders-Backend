import { z } from 'zod';

const trimmed = z.string().trim();
const nullableText = trimmed.min(1).nullable();

// ─── PATCH /api/orders/[id] ─────────────────────────────────────────────────
//
// Edits order *record* fields only. Workflow state (assignment, pick/pack,
// start/skip/verify, status transitions) stays in the dedicated verb routes —
// this mirrors the whitelist enforced by `updateOrder()` in orders-queries.
// Keys are camelCase to match that helper's input shape.

export const OrderUpdateBody = z
  .object({
    productTitle: trimmed.min(1).optional(),
    sku: nullableText.optional(),
    condition: trimmed.min(1).optional(),
    quantity: nullableText.optional(),
    itemNumber: nullableText.optional(),
    shipByDate: nullableText.optional(),
    notes: trimmed.nullable().optional(),
    outOfStock: nullableText.optional(),
    accountSource: nullableText.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

// ─── Tracking sub-resource: /api/orders/[id]/tracking ───────────────────────
//
// Order tracking is NOT an `orders` column — it lives in
// `shipping_tracking_numbers` via `shipment_id` / `order_shipment_links`. These
// bodies drive the shipment-backbone helpers in `orders-tracking-queries.ts`.
// Keys are camelCase to match `applyOrderTrackingOps`.

const trackingNum = z.string().trim().min(1);

export const OrderTrackingPostBody = z
  .object({
    // Primary tracking (slot 0); upsert. '' / null clears it.
    trackingNumber: z.string().trim().nullable().optional(),
    // Additional (non-primary) tracking links to create.
    creates: z.array(z.object({ trackingNumber: trackingNum })).optional(),
    setPrimaryShipmentId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((b) => b.trackingNumber !== undefined || (b.creates?.length ?? 0) > 0, {
    message: 'Provide trackingNumber or at least one create',
  });

export const OrderTrackingPatchBody = z
  .object({
    // Primary tracking (slot 0); upsert. '' / null clears it.
    primaryTrackingNumber: z.string().trim().nullable().optional(),
    edits: z
      .array(z.object({ shipmentId: z.number().int().positive(), trackingNumber: trackingNum }))
      .optional(),
    creates: z.array(z.object({ trackingNumber: trackingNum })).optional(),
    deletes: z.array(z.object({ shipmentId: z.number().int().positive() })).optional(),
    setPrimaryShipmentId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.primaryTrackingNumber !== undefined ||
      b.edits !== undefined ||
      b.creates !== undefined ||
      b.deletes !== undefined ||
      b.setPrimaryShipmentId !== undefined,
    { message: 'At least one tracking operation required' },
  );
