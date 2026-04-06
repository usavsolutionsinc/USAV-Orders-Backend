export type ReplenishmentStatus =
  | 'detected'
  | 'pending_review'
  | 'planned_for_po'
  | 'po_created'
  | 'waiting_for_receipt'
  | 'fulfilled'
  | 'cancelled';

export interface NeedToOrderWaitingOrder {
  order_id?: number;
  channel_order_id?: string | null;
  quantity?: string | number;
}

export interface NeedToOrderRow {
  id: string;
  sku: string | null;
  item_name: string;
  vendor_name: string | null;
  status: ReplenishmentStatus;
  quantity_needed: string | null;
  quantity_to_order: string | null;
  zoho_quantity_available: string | null;
  zoho_quantity_on_hand: string | null;
  zoho_incoming_quantity: string | null;
  zoho_po_id: string | null;
  zoho_po_number: string | null;
  notes: string | null;
  orders_waiting?: NeedToOrderWaitingOrder[] | null;
  created_at: string;
  updated_at: string;
}

export interface ReceivingLineRow {
  id: number;
  receiving_id: number | null;
  zoho_item_id: string;
  item_name: string | null;
  sku: string | null;
  quantity_expected: number;
  quantity_received: number;
  workflow_status: string;
  qa_status: string;
  zoho_purchaseorder_id: string | null;
  created_at: string;
  updated_at: string;
  receiving_tracking_number: string | null;
  carrier: string | null;
  received_at: string | null;
  replenishment_request_id: string | null;
  zoho_po_number: string | null;
  replenishment_status: string | null;
  replenishment_item_name: string | null;
}

export interface ShippedFifoRow {
  sku: string;
  product_title: string;
  account_source: string | null;
  shipped_count: number;
  shipped_qty: number;
  earliest_shipped_at: string;
  latest_shipped_at: string;
  avg_units_per_week: string;
  zoho_item_id: string | null;
  zoho_qty_available: string | null;
  zoho_qty_on_hand: string | null;
  reorder_level: number | null;
  zoho_incoming_qty: string | null;
  active_replenishment_id: string | null;
  replenishment_status: string | null;
  replenishment_qty_needed: string | null;
  zoho_po_number: string | null;
}

export const ACTIVE_STATUSES: ReplenishmentStatus[] = [
  'detected',
  'pending_review',
  'planned_for_po',
  'po_created',
  'waiting_for_receipt',
];

export function statusPillClass(status: string) {
  switch (status) {
    case 'waiting_for_receipt':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'po_created':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'planned_for_po':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'pending_review':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'detected':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'fulfilled':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'cancelled':
      return 'bg-gray-100 text-gray-500 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

export function workflowStatusColor(status: string) {
  switch (status) {
    case 'DONE': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'PASSED': return 'bg-green-100 text-green-700 border-green-200';
    case 'UNBOXED': case 'MATCHED': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'ARRIVED': return 'bg-cyan-100 text-cyan-700 border-cyan-200';
    case 'EXPECTED': return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'AWAITING_TEST': case 'IN_TEST': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'FAILED': case 'RTV': case 'SCRAP': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

export function numText(value: string | number | null | undefined, fallback = '0'): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  // Strip trailing .00 decimals — show whole numbers
  return text.replace(/\.0+$/, '');
}
