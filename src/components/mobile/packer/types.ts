export interface PackerLogRow {
  id: number;
  packer_log_id: number | null;
  created_at: string | null;
  scan_ref: string | null;
  shipping_tracking_number: string | null;
  packed_by: number | null;
  packed_by_name: string | null;
  tracking_type: string | null;
  packer_photos_url: Array<{ id: number; url: string; uploadedAt: string }> | null;
  order_row_id: number | null;
  shipment_id: number | null;
  order_id: string | null;
  account_source: string | null;
  product_title: string | null;
  item_number: string | null;
  condition: string | null;
  quantity: string | number | null;
  sku: string | null;
  notes: string | null;
  serial_number: string | null;
  fnsku: string | null;
}
