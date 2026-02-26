export interface Staff {
  id: number;
  name: string;
  role: string;
  employee_id: string | null;
  source_table: string | null;
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
  notes: string | null;
  is_shipped: boolean;
  created_at: string | null;
}
