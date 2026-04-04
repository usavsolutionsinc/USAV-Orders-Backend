/**
 * Shared FBA type definitions.
 *
 * Single source of truth for interfaces used across the board table,
 * sidebar panels, and station up-next cards.
 */

/* ── Board item (main grid row) ──────────────────────────────────── */

export interface FbaBoardItem {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  item_notes: string | null;
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  shipment_status: string;
  destination_fc: string | null;
  tracking_numbers: { tracking_number: string; carrier: string; label: string }[];
  condition: string | null;
  shipment_ids?: number[];
}

/* ── Shipment card item (line within a shipment) ─────────────────── */

export interface ShipmentCardItem {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  actual_qty: number;
  status: string;
  shipment_id: number;
  /** UPS tracking number this item is allocated to (from fba_tracking_item_allocations). */
  tracking_number?: string | null;
  tracking_carrier?: string | null;
}

/* ── Tracking ────────────────────────────────────────────────────── */

export interface TrackingAllocation {
  shipment_item_id: number;
  qty: number;
}

export interface TrackingRow {
  link_id: number;
  tracking_number_raw: string;
  carrier: string;
  allocations?: TrackingAllocation[];
}

/** One UPS tracking bundle within a shipment — its own items and link_id. */
export interface TrackingBundle {
  link_id: number;
  tracking_number: string;
  carrier: string;
  items: ShipmentCardItem[];
}

/* ── Active shipment (card-level) ────────────────────────────────── */

export interface ActiveShipment {
  id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  status: string;
  shipped_at?: string | null;
  /** All tracking bundles for this shipment (one per UPS tracking number). */
  bundles: TrackingBundle[];
  /** @deprecated Compat — first bundle's values. */
  tracking_numbers: { tracking_number: string; carrier: string }[];
  tracking_link_id?: number | null;
  tracking_number_raw?: string | null;
  tracking_carrier?: string | null;
  items: ShipmentCardItem[];
}
