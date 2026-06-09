/**
 * Shared warranty-claim types + status vocabulary. Import-free of the DB layer
 * so both server (domain module / routes) and client (table, detail, chips) can
 * use it. Keep in sync with warranty_claim_status_enum in
 * 2026-06-06_warranty_claim_logger.sql.
 */

import type { WarrantyClockBasis } from './clock';

export const WARRANTY_CLAIM_STATUSES = [
  'LOGGED',
  'SUBMITTED',
  'APPROVED',
  'DENIED',
  'IN_REPAIR',
  'REPAIRED',
  'CLOSED',
  'EXPIRED',
] as const;

export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

/** Human label per status (sidebar filter + table chip). */
export const WARRANTY_STATUS_LABEL: Record<WarrantyClaimStatus, string> = {
  LOGGED: 'Logged',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  IN_REPAIR: 'In repair',
  REPAIRED: 'Repaired',
  CLOSED: 'Closed',
  EXPIRED: 'Expired',
};

/** Tailwind tone token per status — mirrors the receiving display-primitive tone maps. */
export const WARRANTY_STATUS_TONE: Record<WarrantyClaimStatus, string> = {
  LOGGED: 'slate',
  SUBMITTED: 'blue',
  APPROVED: 'emerald',
  DENIED: 'rose',
  IN_REPAIR: 'amber',
  REPAIRED: 'teal',
  CLOSED: 'gray',
  EXPIRED: 'zinc',
};

export function isWarrantyClaimStatus(value: unknown): value is WarrantyClaimStatus {
  return typeof value === 'string' && (WARRANTY_CLAIM_STATUSES as readonly string[]).includes(value);
}

/** One row in the warranty list (sidebar + right-pane table). */
export interface WarrantyClaimListRow {
  id: number;
  claimNumber: string;
  serialNumber: string | null;
  sku: string | null;
  productTitle: string | null;
  orderId: number | null;
  customerId: number | null;
  customerName: string | null;
  status: WarrantyClaimStatus;
  clockBasis: WarrantyClockBasis | null;
  warrantyStartsAt: string | null;
  warrantyExpiresAt: string | null;
  warrantyDays: number | null;
  /** Whole days until expiry (server-computed). Negative once expired; null when unknown. */
  daysRemaining: number | null;
  denialReasonCode: string | null;
  rmaId: number | null;
  repairServiceId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyClaimEventRow {
  id: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  payload: unknown;
  actorStaffId: number | null;
  createdAt: string;
}

export const WARRANTY_QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export type WarrantyQuoteStatus = (typeof WARRANTY_QUOTE_STATUSES)[number];

export interface WarrantyQuoteLineItem {
  label: string;
  qty: number;
  unitPrice: number;
}

export interface WarrantyQuoteRow {
  id: number;
  quoteNumber: string;
  lineItems: WarrantyQuoteLineItem[];
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  status: WarrantyQuoteStatus;
  sentAt: string | null;
  respondedAt: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface WarrantyRepairAttemptRow {
  id: number;
  attemptNo: number;
  technicianStaffId: number | null;
  diagnosis: string | null;
  partsUsed: unknown;
  outcome: string | null;
  laborMinutes: number | null;
  costParts: string | null;
  costLabor: string | null;
  photoAttachmentIds: unknown;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/**
 * Read-only warranty-coverage lookup result — the "on the phone with a customer"
 * check. Resolves an order #, serial, or SKU to its shipped order and computes
 * the warranty clock WITHOUT logging a claim. `found: false` means no shipped
 * order matched the query.
 */
export interface WarrantyCoverageResult {
  query: string;
  found: boolean;
  /** Which identifier resolved the order. */
  matchedBy: 'order' | 'serial' | 'sku' | null;
  /** Internal orders.id (for prefilling Log Claim). */
  orderId: number | null;
  /** Human/source order number (orders.order_id). */
  sourceOrderId: string | null;
  serialNumber: string | null;
  sku: string | null;
  productTitle: string | null;
  customerId: number | null;
  customerName: string | null;
  sourceSystem: string | null;
  trackingNumber: string | null;
  deliveredAt: string | null;
  packedScannedAt: string | null;
  warrantyStartsAt: string | null;
  warrantyExpiresAt: string | null;
  warrantyDays: number | null;
  clockBasis: WarrantyClockBasis | null;
  /** Whole days until expiry; negative once expired; null when undeterminable. */
  daysRemaining: number | null;
  /** true = covered, false = expired, null = unknown (no delivery/packed date yet). */
  inWarranty: boolean | null;
  /** An already-logged claim for this order/serial, if any. */
  existingClaim: { id: number; claimNumber: string; status: WarrantyClaimStatus } | null;
}

/** Full claim detail (right-pane detail panel). */
export interface WarrantyClaimDetail extends WarrantyClaimListRow {
  purchaseProofUrl: string | null;
  purchasedAt: string | null;
  deliveredAt: string | null;
  packedScannedAt: string | null;
  sourceSystem: string | null;
  sourceOrderId: string | null;
  sourceTrackingNumber: string | null;
  denialNotes: string | null;
  notes: string | null;
  createdByStaffId: number | null;
  /** Linked RMA number (rma_authorizations) when a physical return was issued. */
  rmaNumber: string | null;
  /** Linked repair_service display code (ticket # or RS-<id>) when handed off. */
  repairTicket: string | null;
  events: WarrantyClaimEventRow[];
  repairAttempts: WarrantyRepairAttemptRow[];
  quotes: WarrantyQuoteRow[];
}
