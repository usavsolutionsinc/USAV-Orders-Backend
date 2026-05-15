import { z } from 'zod';

// ─── Reusable building blocks ───────────────────────────────────────────────

const positiveInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();
const trimmedStr = z.string().trim().min(1);
const optTrim = z.string().trim().optional();
const optStaffId = z.number().int().positive().optional();
const optClientEventId = z.string().min(1).optional();

// ─── PATCH /api/locations/[barcode] ─────────────────────────────────────────

const ActionTake = z.object({
  action: z.literal('take'),
  sku: trimmedStr,
  qty: positiveInt,
  staffId: optStaffId,
  reason: optTrim,
  reasonCodeId: positiveInt.optional(),
  notes: z.string().trim().nullable().optional(),
  clientEventId: optClientEventId,
  idempotencyKey: optClientEventId,
});

const ActionPut = ActionTake.extend({
  action: z.literal('put'),
});

const ActionSet = z.object({
  action: z.literal('set'),
  sku: trimmedStr,
  qty: nonNegInt,
  minQty: nonNegInt.nullable().optional(),
  maxQty: nonNegInt.nullable().optional(),
  staffId: optStaffId,
  expectedUpdatedAt: optTrim,
  reasonCodeId: positiveInt.optional(),
  notes: z.string().trim().nullable().optional(),
  clientEventId: optClientEventId,
  idempotencyKey: optClientEventId,
});

const ActionCount = z.object({
  action: z.literal('count'),
  sku: trimmedStr,
  staffId: optStaffId,
  clientEventId: optClientEventId,
  idempotencyKey: optClientEventId,
});

export const LocationsPatchBody = z.discriminatedUnion('action', [
  ActionTake,
  ActionPut,
  ActionSet,
  ActionCount,
]);
export type LocationsPatchBody = z.infer<typeof LocationsPatchBody>;

// ─── POST /api/locations/[barcode]/swap ─────────────────────────────────────

export const LocationsSwapBody = z.object({
  oldSku: trimmedStr,
  newSku: trimmedStr,
  qty: positiveInt.optional(),
  staffId: optStaffId,
  clientEventId: optClientEventId,
  idempotencyKey: optClientEventId,
});
export type LocationsSwapBody = z.infer<typeof LocationsSwapBody>;

// ─── POST /api/transfers ────────────────────────────────────────────────────

export const TransfersBody = z.object({
  fromBinBarcode: trimmedStr,
  toBinBarcode: trimmedStr,
  sku: trimmedStr,
  qty: positiveInt,
  reasonCodeId: positiveInt.optional(),
  notes: z.string().trim().optional(),
  staffId: optStaffId,
  clientEventId: optClientEventId,
  idempotencyKey: optClientEventId,
});
export type TransfersBody = z.infer<typeof TransfersBody>;

// ─── PATCH /api/sku-stock/[sku] ─────────────────────────────────────────────

const SkuStockAdjust = z.object({
  action: z.literal('adjust'),
  delta: z.number().int(),
  reason: optTrim,
  staffId: optStaffId,
});
const SkuStockSet = z.object({
  action: z.literal('set'),
  absoluteQty: nonNegInt,
  reason: optTrim,
  staffId: optStaffId,
});
const SkuStockLocation = z.object({
  action: z.literal('location'),
  location: trimmedStr,
  staffId: optStaffId,
});
const SkuStockRename = z.object({
  action: z.literal('rename'),
  productTitle: z.string().optional(),
  clearOverride: z.boolean().optional(),
  staffId: optStaffId,
  clientEventId: optClientEventId,
  idempotencyKey: optClientEventId,
});

export const SkuStockPatchBody = z.discriminatedUnion('action', [
  SkuStockAdjust,
  SkuStockSet,
  SkuStockLocation,
  SkuStockRename,
]);
export type SkuStockPatchBody = z.infer<typeof SkuStockPatchBody>;
