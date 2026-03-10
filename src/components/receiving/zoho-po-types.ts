export interface ZohoPOLine {
  line_item_id: string;
  item_id: string;
  name?: string;
  sku?: string;
  description?: string;
  quantity?: number;
  quantity_received?: number;
  rate?: number;
  total?: number;
  unit?: string;
}

export interface ZohoPO {
  purchaseorder_id: string;
  purchaseorder_number?: string;
  vendor_name?: string;
  status?: string;
  date?: string;
  delivery_date?: string;
  expected_delivery_date?: string;
  total?: number;
  currency_code?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  line_items?: ZohoPOLine[];
  reference_number?: string;
}

export type POStatus = 'issued' | 'partially_received' | 'open' | 'received' | 'draft' | 'cancelled' | 'all';

export const STATUS_OPTIONS: Array<{ value: POStatus; label: string }> = [
  { value: 'issued',             label: 'Issued' },
  { value: 'partially_received', label: 'Partially Received' },
  { value: 'open',               label: 'Open' },
  { value: 'received',           label: 'Received' },
  { value: 'draft',              label: 'Draft' },
  { value: 'cancelled',          label: 'Cancelled' },
  { value: 'all',                label: 'All' },
];

export const CONDITION_OPTIONS = [
  { value: 'BRAND_NEW', label: 'Brand New' },
  { value: 'USED_A',    label: 'Used — A' },
  { value: 'USED_B',    label: 'Used — B' },
  { value: 'USED_C',    label: 'Used — C' },
  { value: 'PARTS',     label: 'Parts' },
] as const;

export const CHANNEL_OPTIONS = [
  { value: '',       label: 'No Channel' },
  { value: 'ORDERS', label: 'Orders' },
  { value: 'FBA',    label: 'FBA' },
] as const;

export function statusColor(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'issued':             return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'partially_received': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'received':           return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'open':               return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'draft':              return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'cancelled':          return 'bg-red-50 text-red-600 border-red-200';
    default:                   return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

export function fmtDate(d?: string) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
}

export function fmtCurrency(n?: number, code?: string) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code || 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}
