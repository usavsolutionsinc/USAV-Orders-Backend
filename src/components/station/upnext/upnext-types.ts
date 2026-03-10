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

export interface FBAQueueItem {
  item_id: number;
  shipment_id: number;
  shipment_ref: string;
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  expected_qty: number;
  actual_qty: number;
  status: 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  assigned_tech_name: string | null;
  due_date: string | null;
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
  is_shipped: boolean;
}

export interface RepairQueueItem {
  kind: 'REPAIR';
  repairId: number;
  assignmentId: number | null;
  assignmentStatus: string | null;
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
}

export const FBA_ITEM_STATUS_BADGE: Record<string, string> = {
  PLANNED:        'bg-gray-100 text-gray-500 border-gray-200',
  READY_TO_GO:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  LABEL_ASSIGNED: 'bg-blue-100 text-blue-700 border-blue-200',
  SHIPPED:        'bg-purple-100 text-purple-700 border-purple-200',
};
