export type ItemStatus =
  | 'ready_to_print'
  | 'needs_print'
  | 'pending_out_of_stock'
  | 'pending_qc_fail'
  | 'shipped';

export type PendingReason = 'out_of_stock' | 'qc_fail' | null;

export interface PrintQueueItem {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  destination_fc: string | null;
  item_notes?: string | null;
  pending_reason?: string | null;
  pending_reason_note?: string | null;
}

export interface EnrichedItem extends PrintQueueItem {
  status: ItemStatus;
  pending_reason: PendingReason;
  pending_reason_note?: string;
  expanded: boolean;
}

export interface TableState {
  items: EnrichedItem[];
  selected: Set<number>;
  loading: boolean;
  error: string | null;
  expandedItemId: number | null;
  viewMode: 'by_day' | 'by_shipment';
  dayFilter: string | null;
}

export type TableAction =
  | { type: 'SET_ITEMS'; payload: EnrichedItem[] }
  | { type: 'REFRESH_ITEMS'; payload: EnrichedItem[] }
  | { type: 'TOGGLE_SELECT'; id: number }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' }
  | { type: 'SELECT_SHIPMENT'; shipment_id: number }
  | { type: 'TOGGLE_EXPAND'; id: number }
  | { type: 'SET_EXPANDED'; id: number | null }
  | { type: 'PATCH_ITEM'; id: number; patch: Partial<EnrichedItem> }
  | { type: 'REMOVE_ITEM'; id: number }
  | { type: 'RESTORE_ITEM'; item: EnrichedItem }
  | { type: 'SET_VIEW_MODE'; mode: 'by_day' | 'by_shipment' }
  | { type: 'SET_DAY_FILTER'; date: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null };

export interface PrintSelectionPayload {
  selectedItems: EnrichedItem[];
  shipmentIds: number[];
  readyCount: number;
  pendingCount: number;
  needsPrintCount: number;
}

export interface ShipmentGroup {
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  destination_fc: string | null;
  items: EnrichedItem[];
}

export interface DayBucket {
  dayKey: string;
  label: string;
  groups: ShipmentGroup[];
}
