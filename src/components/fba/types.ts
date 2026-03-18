export interface FbaSummaryRow {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  tech_scanned_qty: number;
  pack_ready_qty: number;
  shipped_qty: number;
  available_to_ship: number;
  shipment_ref: string | null;
  shipment_item_status: string | null;
  expected_qty: number | null;
  actual_qty: number | null;
}
