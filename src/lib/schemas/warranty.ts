import { z } from 'zod';
import { WARRANTY_CLAIM_STATUSES } from '@/lib/warranty/types';

/**
 * Zod surfaces for the Warranty Claim Logger API.
 *
 * Phase 1 ships the list-query validator. Mutation bodies (create / deny /
 * repair / quote) are added in Phase 2 next to their verb routes.
 */

const trimmed = z.string().trim();

// ─── GET /api/warranty/claims (query params) ────────────────────────────────
export const WarrantyClaimListQuery = z
  .object({
    status: z.enum(WARRANTY_CLAIM_STATUSES).optional(),
    search: trimmed.min(1).max(200).optional(),
    /** Only claims expiring within N days (incl. overdue). */
    expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
    /** Only claims still on a provisional (packed+estimate) clock. */
    provisionalOnly: z
      .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
      .transform((v) => v === '1' || v === 'true')
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strip();

export type WarrantyClaimListQueryInput = z.infer<typeof WarrantyClaimListQuery>;

// ─── Shared scalars ─────────────────────────────────────────────────────────
const isoDate = trimmed
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'invalid date' });
const positiveInt = z.coerce.number().int().positive();
const optionalIdempotencyKey = z.string().trim().min(1).max(200).optional();

// ─── POST /api/warranty/claims (create) ─────────────────────────────────────
export const WarrantyClaimCreateBody = z
  .object({
    serialNumber: trimmed.min(1).max(200).optional(),
    serialUnitId: positiveInt.optional(),
    orderId: positiveInt.optional(),
    sku: trimmed.min(1).max(255).optional(),
    productTitle: trimmed.min(1).max(500).optional(),
    customerId: positiveInt.optional(),
    sourceSystem: trimmed.min(1).max(64).optional(),
    sourceOrderId: trimmed.min(1).max(128).optional(),
    sourceTrackingNumber: trimmed.min(1).max(128).optional(),
    purchaseProofUrl: trimmed.min(1).max(2000).optional(),
    purchaseProofAttachmentId: trimmed.min(1).max(500).optional(),
    purchasedAt: isoDate.optional(),
    deliveredAt: isoDate.optional(),
    packedScannedAt: isoDate.optional(),
    notes: trimmed.min(1).max(4000).optional(),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict()
  .refine(
    (b) => Boolean(b.serialNumber || b.serialUnitId || b.orderId || b.sku),
    { message: 'a serial, order, or SKU is required' },
  );

// ─── PATCH /api/warranty/claims/[id] (metadata only) ────────────────────────
export const WarrantyClaimUpdateBody = z
  .object({
    serialNumber: trimmed.min(1).max(200).optional(),
    sku: trimmed.min(1).max(255).optional(),
    productTitle: trimmed.min(1).max(500).optional(),
    customerId: positiveInt.optional(),
    sourceTrackingNumber: trimmed.min(1).max(128).optional(),
    purchaseProofUrl: trimmed.min(1).max(2000).optional(),
    purchaseProofAttachmentId: trimmed.min(1).max(500).optional(),
    purchasedAt: isoDate.optional(),
    notes: trimmed.min(1).max(4000).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

// ─── POST /api/warranty/claims/[id]/deny ────────────────────────────────────
export const WarrantyDenyBody = z
  .object({
    reasonCode: trimmed.min(1).max(64),
    denialNotes: trimmed.min(1).max(4000).optional(),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict();

// ─── POST /api/warranty/claims/[id]/{submit,approve,close} (optional body) ──
export const WarrantyVerbBody = z
  .object({ idempotencyKey: optionalIdempotencyKey })
  .strip();

// ─── POST /api/warranty/claims/[id]/repair ──────────────────────────────────
export const WarrantyRepairBody = z
  .object({
    technicianStaffId: positiveInt.optional(),
    diagnosis: trimmed.min(1).max(4000).optional(),
    partsUsed: z
      .array(
        z.object({
          sku: trimmed.min(1).max(255).optional(),
          qty: z.number().int().min(0).optional(),
          cost: z.number().min(0).optional(),
        }),
      )
      .max(100)
      .optional(),
    outcome: z.enum(['FIXED', 'NOT_FIXABLE', 'PENDING_PARTS', 'RTV']).optional(),
    laborMinutes: z.number().int().min(0).optional(),
    costParts: z.number().min(0).optional(),
    costLabor: z.number().min(0).optional(),
    photoAttachmentIds: z.array(trimmed.min(1).max(500)).max(50).optional(),
    notes: trimmed.min(1).max(4000).optional(),
    startedAt: isoDate.optional(),
    completedAt: isoDate.optional(),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict();

// ─── POST /api/warranty/claims/[id]/rma (issue new, or link existing by number) ─
export const WarrantyRmaBody = z
  .object({
    /** When provided, link this existing RMA instead of issuing a new one. */
    rmaNumber: trimmed.min(1).max(64).optional(),
    expectedCarrier: trimmed.min(1).max(64).optional(),
    expiresAt: isoDate.optional(),
    notes: trimmed.min(1).max(4000).optional(),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict();

// ─── POST /api/warranty/claims/[id]/repair-handoff ──────────────────────────
export const WarrantyRepairHandoffBody = z
  .object({
    issue: trimmed.min(1).max(2000).optional(),
    notes: trimmed.min(1).max(4000).optional(),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict();

// ─── GET /api/warranty/reports/export ───────────────────────────────────────
export const WarrantyReportQuery = z
  .object({
    status: z.enum(WARRANTY_CLAIM_STATUSES).optional(),
    sku: trimmed.min(1).max(255).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    outcome: z.enum(['FIXED', 'NOT_FIXABLE', 'PENDING_PARTS', 'RTV']).optional(),
    format: z.enum(['csv', 'json']).optional(),
  })
  .strip();

// ─── POST /api/warranty/claims/[id]/quote ───────────────────────────────────
export const WarrantyQuoteCreateBody = z
  .object({
    lineItems: z
      .array(
        z.object({
          label: trimmed.min(1).max(200),
          qty: z.number().min(0),
          unitPrice: z.number().min(0),
        }),
      )
      .min(1)
      .max(100),
    tax: z.number().min(0).optional(),
    validUntil: isoDate.optional(),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict();

// ─── PATCH /api/warranty/quotes/[id] ────────────────────────────────────────
export const WarrantyQuoteStatusBody = z
  .object({
    status: z.enum(['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED']),
    idempotencyKey: optionalIdempotencyKey,
  })
  .strict();

export type WarrantyClaimCreateInput = z.infer<typeof WarrantyClaimCreateBody>;
export type WarrantyRepairInput = z.infer<typeof WarrantyRepairBody>;
