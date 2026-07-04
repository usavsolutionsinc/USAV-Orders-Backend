/**
 * Types for the receiving-triage right panel.
 *
 * Triage job: an inbound customer-return (or other non-PO) package arrives and
 * the operator pairs it against real integration data (Zendesk claim ticket,
 * Ecwid/eBay/Amazon order/return) so the order's status can be updated. These
 * types model only what we can derive from REAL signals already in the system —
 * there is deliberately no fabricated "confidence score" field. Relevance is
 * conveyed by genuine attributes (already-linked, exact-id match, recency).
 *
 * Built for multi-tenant extensibility: `IntegrationSourceKind` is the seam
 * where a new tenant integration (e.g. Shopify, WooCommerce) slots in without
 * the panel learning the integration's internals — adapters map a source row
 * into the shared candidate shapes below.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Where a triage signal originated. Extend here when onboarding a new integration. */
export type IntegrationSourceKind =
  | 'zendesk'
  | 'ecwid'
  | 'ebay'
  | 'amazon'
  | 'zoho'
  | 'platform';

/**
 * A normalized inbound package under triage, derived from a `ReceivingLineRow`.
 * The panel renders from this — never from raw row fields — so the display stays
 * dumb and the derivation rules live in one place (`toTriagePackage`).
 */
export interface TriagePackage {
  lineId: number;
  receivingId: number | null;
  tracking: string | null;
  carrier: string | null;
  /** Best available arrival timestamp + which event it represents. */
  arrivalAt: string | null;
  arrivalLabel: 'Received' | 'Scanned' | 'Logged' | null;
  /** ebay | amazon | ecwid | fba | … (lowercase slug from source-platform SoT). */
  sourcePlatform: string | null;
  isReturn: boolean;
  /** po | return | trade_in (effective line intake type) | null. */
  intakeType: string | null;
  /** True for a no-Zoho-PO carton (the classic unmatched-inbound triage case). */
  isUnmatched: boolean;
  zohoPoId: string | null;
  poNumber: string | null;
  vendorName: string | null;
  itemName: string | null;
  sku: string | null;
  qtyReceived: number;
  qtyExpected: number | null;
  /** "#1234" when a Zendesk ticket is already linked. */
  zendeskTicket: string | null;
  imageUrl: string | null;
}

/**
 * A linkable Zendesk ticket candidate — mirrors the
 * `/api/receiving/zendesk-claim/link` GET payload (`TicketLinkCandidate`).
 * This is the real "smart match" surface for returns: the customer's claim
 * ticket is what a return package pairs to.
 */
export interface TicketCandidate {
  id: number;
  subject: string | null;
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
  /** True when this ticket is already linked to the package under triage. */
  linkedToThis: boolean;
}

/**
 * An eBay (or marketplace) "order delivered" email signal for this package's PO.
 * A real, carrier-confirmed delivery event surfaced from `email_delivery_signals`
 * via the incoming/details endpoint — a strong corroborating match hint.
 */
export interface DeliveredEmailSignal {
  orderNumber: string;
  deliveredAt: string | null;
  subject: string | null;
  from: string | null;
}

/** Derive the dumb-render `TriagePackage` from a receiving line row. */
export function toTriagePackage(row: ReceivingLineRow): TriagePackage {
  const intakeType =
    row.intake_type ??
    (row.carton_intake_type ? row.carton_intake_type.toLowerCase() : null);
  const isReturn =
    intakeType === 'return' ||
    (row.source_platform ?? '').toLowerCase().includes('return');

  // Prefer the most meaningful arrival event we have a timestamp for.
  let arrivalAt: string | null = null;
  let arrivalLabel: TriagePackage['arrivalLabel'] = null;
  if (row.received_at) {
    arrivalAt = row.received_at;
    arrivalLabel = 'Received';
  } else if (row.scanned_at) {
    arrivalAt = row.scanned_at;
    arrivalLabel = 'Scanned';
  } else if (row.created_at) {
    arrivalAt = row.created_at;
    arrivalLabel = 'Logged';
  }

  return {
    lineId: row.id,
    receivingId: row.receiving_id,
    tracking: row.tracking_number,
    carrier: row.carrier,
    arrivalAt,
    arrivalLabel,
    sourcePlatform: row.source_platform_pill ?? row.source_platform ?? null,
    isReturn,
    intakeType,
    isUnmatched: row.receiving_source === 'unmatched',
    zohoPoId: row.zoho_purchaseorder_id,
    poNumber: row.zoho_purchaseorder_number,
    vendorName: row.vendor_name ?? null,
    itemName:
      row.zoho_item_title ??
      row.catalog_product_title ??
      row.item_name ??
      null,
    sku: row.sku,
    qtyReceived: row.quantity_received,
    qtyExpected: row.quantity_expected,
    zendeskTicket: row.zendesk_ticket ?? null,
    imageUrl: row.image_url,
  };
}

/** Map a Zendesk ticket status to a semantic chip tone (real status, not a score). */
export function ticketStatusTone(status: string): {
  bg: string;
  text: string;
  ring: string;
  label: string;
} {
  switch (status.toLowerCase()) {
    case 'new':
      return { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200', label: 'New' };
    case 'open':
      return { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', label: 'Open' };
    case 'pending':
      return { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200', label: 'Pending' };
    case 'hold':
      return { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-200', label: 'Hold' };
    case 'solved':
      return { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', label: 'Solved' };
    case 'closed':
      return { bg: 'bg-surface-sunken', text: 'text-text-muted', ring: 'ring-border-soft', label: 'Closed' };
    default:
      return { bg: 'bg-surface-canvas', text: 'text-text-muted', ring: 'ring-border-soft', label: status || '—' };
  }
}

/** Short relative-time label (e.g. "3d ago"); falls back to a date for old rows. */
export function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
