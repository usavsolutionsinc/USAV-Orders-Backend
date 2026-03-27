export interface Staff {
  id: number;
  name: string;
  role: string;
  employee_id: string | null;
  active: boolean;
  created_at?: string | null;
}

export interface Order {
  id: number;
  ship_by_date: string | null;
  order_id: string;
  product_title: string;
  quantity?: string | number | null;
  item_number?: string | null;
  account_source?: string | null;
  sku: string;
  shipping_tracking_number: string | null;
  tester_id: number | null;
  packer_id: number | null;
  out_of_stock: string | null;
  replenishment_request_id?: string | null;
  replenishment_status?: string | null;
  replenishment_quantity_to_order?: string | null;
  replenishment_po_number?: string | null;
  replenishment_notes?: string | null;
  notes: string | null;
  /** Derived from shipping_tracking_numbers carrier status */
  is_shipped?: boolean;
  created_at: string | null;
}

export type AdminFeatureType = 'feature' | 'bug_fix';
export type AdminFeatureStatus = 'backlog' | 'in_progress' | 'done';
export type AdminFeaturePriority = 'low' | 'medium' | 'high';

export interface AdminFeatureRecord {
  id: number;
  title: string;
  description: string | null;
  type: AdminFeatureType;
  status: AdminFeatureStatus;
  priority: AdminFeaturePriority;
  pageArea: string | null;
  sortOrder: number;
  isActive: boolean;
  assignedToStaffId: number | null;
  assignedToStaffName: string | null;
  createdByStaffId: number | null;
  updatedByStaffId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}
