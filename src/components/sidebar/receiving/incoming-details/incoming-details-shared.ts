import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { copyToClipboard } from '@/utils/_dom';
import { toast } from '@/lib/toast';

// ── Tab spec ────────────────────────────────────────────────────────────────
export type TabId = 'po' | 'ebay' | 'shipment' | 'activity' | 'email' | 'notes';
export const TABS: Array<{ value: TabId; label: string }> = [
  { value: 'po',       label: 'PO' },
  { value: 'shipment', label: 'Shipment' },
  { value: 'activity', label: 'Activity' },
  { value: 'email',    label: 'Email' },
  { value: 'notes',    label: 'Notes' },
];

/**
 * Tabs for the panel given the loaded data. Universal Incoming (plan §7.3): a
 * non-Zoho (eBay) row swaps the "PO" tab for an "eBay" tab; a merged row (eBay
 * primary + a Zoho link) shows both. Email/PO-only tabs drop for a pure inbound
 * row that has no Zoho mirror to read.
 */
export function tabsForData(data: DetailsResponse | undefined): Array<{ value: TabId; label: string }> {
  const inbound = data?.inbound ?? null;
  if (!inbound) return TABS;
  const hasZoho = inbound.links.some((l) => l.source_type === 'zoho') || Boolean(data?.po);
  const label = inbound.source_type === 'ebay' ? 'eBay' : inbound.source_type.charAt(0).toUpperCase() + inbound.source_type.slice(1);
  const tabs: Array<{ value: TabId; label: string }> = [{ value: 'ebay', label }];
  if (hasZoho) tabs.push({ value: 'po', label: 'PO' });
  tabs.push({ value: 'shipment', label: 'Shipment' });
  tabs.push({ value: 'activity', label: 'Activity' });
  tabs.push({ value: 'notes', label: 'Notes' });
  return tabs;
}

// ── Response types (loose — only the fields the panel renders) ──────────────
export interface DetailsResponse {
  success: true;
  po: {
    zoho_purchaseorder_id: string;
    zoho_purchaseorder_number: string;
    vendor_id: string | null;
    vendor_name: string | null;
    status: string | null;
    po_date: string | null;
    expected_delivery_date: string | null;
    reference_number: string | null;
    total: string | null;
    currency: string | null;
    last_modified_zoho: string | null;
    last_synced_at: string;
    raw?: Record<string, unknown>;
  } | null;
  receiving: {
    id: number;
    shipment_id: number | null;
    received_at: string | null;
  } | null;
  line_items: Array<{
    line_item_id: string | null;
    item_id: string | null;
    sku: string | null;
    name: string | null;
    description: string | null;
    quantity_expected: number;
    quantity_received: number;
    workflow_status: string | null;
    receiving_line_id: number | null;
    rate: number | null;
    item_total: number | null;
  }>;
  shipment: {
    shipment_id: number;
    tracking_number: string | null;
    carrier: string | null;
    latest_status_category: string | null;
    is_delivered: boolean | null;
    delivered_at: string | null;
    last_checked_at: string | null;
    out_for_delivery_at: string | null;
    events: Array<{
      id: number;
      event_occurred_at: string | null;
      normalized_status_category: string;
      external_status_label: string | null;
      external_status_description: string | null;
      event_city: string | null;
      event_state: string | null;
      exception_description: string | null;
      signed_by: string | null;
    }>;
  } | null;
  receive_events: Array<{
    id: number;
    occurred_at: string;
    event_type: string;
    actor_staff_id: number | null;
    actor_name: string | null;
    station: string | null;
    sku: string | null;
    serial_number: string | null;
    serial_unit_id: number | null;
    prev_status: string | null;
    next_status: string | null;
    notes: string | null;
  }>;
  gmail: Array<{
    id: number;
    gmail_msg_id: string;
    gmail_thread_id: string | null;
    email_subject: string | null;
    email_from: string | null;
    email_received: string | null;
    status: string | null;
    scanned_at: string | null;
  }>;
  delivered_emails: Array<{
    gmail_msg_id: string;
    gmail_thread_id: string | null;
    order_number: string;
    email_subject: string | null;
    email_from: string | null;
    snippet: string | null;
    delivered_at: string | null;
  }>;
  zoho_activity: Array<{
    timestamp: string | null;
    label: string;
    description: string | null;
  }>;
  /**
   * Present for a non-Zoho (eBay / marketplace) Incoming row. Carries the
   * polymorphic purchase identity, the reconcile-mirror snapshot, and the
   * marketplace facts the eBay tab renders. `po` is null for a pure inbound row.
   */
  inbound?: {
    source_type: string;
    source_order_id: string;
    order_number: string | null;
    seller_name: string | null;
    status: string | null;
    payment_status: string | null;
    listing_url: string | null;
    account_label: string | null;
    receiving_line_id: number;
    zoho_purchaseorder_id: string | null;
    links: Array<{ source_type: string; source_order_id: string; is_primary: boolean }>;
  } | null;
  notes: string | null;
}

export interface IncomingDetailsPanelProps {
  /**
   * Zoho PO id to key the panel on. Null for a shipment-anchored "Delivered ·
   * not scanned" box that never resolved to a PO — pass {@link shipmentId}
   * instead and the panel opens in shipment-only mode (Shipment tab + a hard
   * "Remove from Incoming" delete; PO/Email/Notes show empty states).
   */
  zohoPurchaseOrderId: string | null;
  /** Display label for the close button — typically the PO number. */
  poNumberHint?: string | null;
  /** Shipment id (shipping_tracking_numbers.id) for the PO-less fallback. */
  shipmentId?: number | null;
  /**
   * Universal Incoming (plan §7.3): for a non-Zoho row with no zoho PO of its
   * own, the panel keys on the polymorphic link identity instead — the primary
   * source (e.g. 'ebay') + its external order id.
   */
  inboundSourceType?: string | null;
  inboundSourceOrderId?: string | null;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export function fmtDate(value: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  if (!value) return '—';
  try {
    return format(typeof value === 'string' ? parseISO(value) : value, pattern);
  } catch {
    return value;
  }
}

export function fmtDateTime(value: string | null | undefined): string {
  return fmtDate(value, 'MMM d, yyyy · h:mma');
}

export function fmtMoney(total: string | number | null, currency: string | null): string {
  if (total == null || total === '') return '—';
  const n = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(n)) return '—';
  const cur = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

export async function copyValue(value: string | null | undefined, label: string) {
  if (!value) return;
  const ok = await copyToClipboard(value);
  if (ok) toast.success(`${label} copied`);
  else toast.error(`Couldn't copy ${label.toLowerCase()}`);
}

export function shortCarrier(carrier: string | null | undefined): string {
  const c = (carrier || '').toUpperCase();
  if (c.includes('FEDEX')) return 'FedEx';
  if (c.includes('USPS')) return 'USPS';
  if (c.includes('UPS')) return 'UPS';
  return carrier ? String(carrier) : '';
}

export function deliveredAgoLabel(deliveredAt: string | null | undefined): string | null {
  if (!deliveredAt) return null;
  const d = new Date(deliveredAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${formatDistanceToNowStrict(d)} ago`;
}

// Tone for the status hero — mirrors the dot colors so the headline status
// reads the same as its trail. Returns the wrapper + accent classes.
export function heroTone(category: string | null | undefined, delivered: boolean | null): {
  wrap: string;
  status: string;
  dot: string;
} {
  const c = (category || '').toLowerCase();
  if (delivered || (c.includes('deliver') && !c.includes('out')))
    return { wrap: 'border-emerald-200 bg-emerald-50', status: 'text-emerald-800', dot: 'bg-emerald-500' };
  if (c.includes('exception') || c.includes('fail') || c.includes('return'))
    return { wrap: 'border-rose-200 bg-rose-50', status: 'text-rose-800', dot: 'bg-rose-500' };
  if (c.includes('out_for_delivery') || c.includes('ofd'))
    return { wrap: 'border-amber-200 bg-amber-50', status: 'text-amber-800', dot: 'bg-amber-500' };
  if (c.includes('pre_transit') || c.includes('label') || c.includes('created') || c.includes('unknown'))
    return { wrap: 'border-border-soft bg-surface-canvas', status: 'text-text-muted', dot: 'bg-border-emphasis' };
  return { wrap: 'border-blue-200 bg-blue-50', status: 'text-blue-800', dot: 'bg-blue-500' };
}

// Humanize a normalized status category ("in_transit" → "In transit") for the
// hero headline, preferring the carrier's own latest label when present.
export function prettyStatus(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
