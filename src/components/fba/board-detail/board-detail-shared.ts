import type { FbaBoardItem } from '../FbaBoardTable';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface PlanEntry {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  item_notes: string | null;
  condition: string | null;
  item_created_at: string;
  shipment_id: number;
  shipment_ref: string;
  due_date: string | null;
  shipment_status: string;
  destination_fc: string | null;
  amazon_shipment_id: string | null;
  plan_created_at: string;
  tracking_numbers: { tracking_number: string; carrier: string; label: string }[];
}

export interface ScanLog {
  id: number;
  source_stage: string;
  event_type: string;
  staff_name: string | null;
  station: string | null;
  quantity: number;
  created_at: string;
}

export interface FbaBoardDetailPanelProps {
  item: FbaBoardItem;
  onClose: () => void;
  onNavigate: (direction: 'up' | 'down') => void;
  onSaved: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

/** Friendly label for a scan log row (who-did-what). */
export function scanActionLabel(stage: string, event: string): string {
  const s = (stage || '').toUpperCase();
  const e = (event || '').toUpperCase();
  if (e === 'SHIPPED') return 'Shipped';
  if (e === 'ASSIGNED') return 'Combined';
  if (s === 'TECH') return 'Tested';
  if (s === 'PACK') return 'Packed';
  if (s === 'ADMIN') return 'Admin';
  return e ? e.charAt(0) + e.slice(1).toLowerCase() : 'Scanned';
}

export function formatPlanDate(raw: string | null): string {
  if (!raw) return 'No date';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatCreatedAt(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
