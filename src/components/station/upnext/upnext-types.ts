export interface ReceivingQueueItem {
  assignment_id: number;
  receiving_id: number;
  assigned_tech_id: number | null;
  assigned_tech_name: string | null;
  status: string;
  priority: number;
  notes: string | null;
  assigned_at: string | null;
  tracking_number: string | null;
  carrier: string | null;
  qa_status: string | null;
  workflow_status: string | null;
  line_count: number;
  line_skus: string[];
}

/**
 * Open FBA plan row for the /fba workspace sidebar.
 * - `id` — internal `fba_shipments.id` (numeric row id; URL `?plan=` uses this).
 * - `shipment_ref` — human **plan id** (e.g. `FBA-03/24/26`), not Amazon’s FBA shipment id.
 * Not used on station testing routes — pair with {@link FbaShipmentCard}.
 */
export interface FbaPlanQueueItem {
  /** Internal DB id (`fba_shipments.id`) — distinct from {@link shipment_ref}. */
  id: number;
  /** Plan code shown to staff (`fba_shipments.shipment_ref`). */
  shipment_ref: string;
  due_date: string | null;
  total_items: number;
  total_expected_qty: number;
  ready_item_count: number;
  shipped_item_count: number;
  created_by_name: string | null;
  created_at: string;
  amazon_shipment_id?: string | null;
  tracking_numbers?: { tracking_number: string; carrier: string; label?: string | null }[];
}

export interface FBAQueueItem {
  item_id: number;
  /** Internal `fba_shipments.id` (same as plan list `id` — not the plan code). */
  shipment_id: number;
  /** Plan id / human ref (`fba_shipments.shipment_ref`). */
  shipment_ref: string;
  plan_title?: string | null;
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  condition?: string | null;
  expected_qty: number;
  actual_qty: number;
  status: 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  assigned_tech_id?: number | null;
  assigned_packer_id?: number | null;
  assigned_tech_name: string | null;
  due_date: string | null;
  deadline_at?: string | null;
}

export interface Order {
  id: number;
  ship_by_date: string | null;
  created_at: string | null;
  order_id: string;
  product_title: string;
  item_number: string | null;
  account_source: string | null;
  sku: string;
  condition?: string | null;
  quantity?: string | null;
  status: string;
  shipping_tracking_number: string;
  out_of_stock: string | null;
  /** Staff id from work_assignments; null means unassigned (visible to all techs) */
  tester_id?: number | null;
  /** Display name of the assigned tester */
  tester_name?: string | null;
  /** PACK work_assignment (realtime may populate before next /api/orders/next fetch) */
  packer_id?: number | null;
  packer_name?: string | null;
  /** True when a tech_serial_numbers scan exists for this shipment_id (order already processed) */
  has_tech_scan?: boolean;
  /** Derived from shipping_tracking_numbers carrier status */
  is_shipped?: boolean;
}

export interface RepairQueueItem {
  kind: 'REPAIR';
  repairId: number;
  assignmentId: number | null;
  assignmentStatus: string | null;
  deadlineAt: string | null;
  ticketNumber: string;
  productTitle: string;
  issue: string;
  serialNumber: string;
  contactInfo: string;
  dateTime: string;
  repairStatus: string;
  price: string;
  assignedTechId: number | null;
  techName: string | null;
  outOfStock: string | null;
  repairOutcome: string | null;
  /** From repair_service.source_sku — opens Ecwid keyword search */
  sku?: string | null;
}

export const FBA_ITEM_STATUS_BADGE: Record<string, string> = {
  PLANNED:        'bg-gray-100 text-gray-500 border-gray-200',
  READY_TO_GO:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  LABEL_ASSIGNED: 'bg-blue-100 text-blue-700 border-blue-200',
  SHIPPED:        'bg-purple-100 text-purple-700 border-purple-200',
};
