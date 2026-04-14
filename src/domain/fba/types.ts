/**
 * Clean domain types for the FBA flow.
 *
 * Two workflow phases live on the same `fba_shipments` row:
 *
 *   **Plan** — the prep-queue phase. An FNSKU (or a group of them) has been
 *   added to the DB so every tech can see it on their station up-next (via
 *   `FbaItemCard` in `UpNextOrder`). At this stage there is no Amazon FBA ID
 *   and no UPS tracking; just "these SKUs need to be prepped for FBA".
 *
 *   **Shipment** — the outbound phase. An Amazon FBA shipment ID now pairs
 *   one-or-more UPS tracking numbers (one per physical box). Same FBA ID →
 *   many UPS trackings → many boxes. Rendered via `FbaShipmentCard` and
 *   `FbaActiveShipments`.
 *
 * Naming in this file is historical — the outbound record type is called
 * `FbaPlan` because "plan" was the original name before the prep queue grew
 * on top. Do not rename; UI copy disambiguates per surface (plan vs shipment).
 *
 *   "Box" = a carrier tracking number with items allocated to it.
 */

// ── Plan ────────────────────────────────────────────────────────────────────

export type FbaPlanStatus = 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';

/** Internal plan — typically one per day. `label` is purely for human readability. */
export interface FbaPlan {
  id: number;
  /** Human-readable label stored in `fba_shipments.shipment_ref`. NOT a key. */
  label: string;
  amazonShipmentId: string | null;
  destinationFc: string | null;
  dueDate: string | null;
  status: FbaPlanStatus;
  createdByStaffId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Plan Item ───────────────────────────────────────────────────────────────

/** One FNSKU line in a plan. UNIQUE(planId, fnsku). */
export interface FbaPlanItem {
  id: number;
  planId: number;
  fnsku: string;
  displayTitle: string;
  asin: string | null;
  sku: string | null;
  expectedQty: number;
  actualQty: number;
  status: string;
  notes: string | null;
}

// ── Box (tracking allocation) ───────────────────────────────────────────────

/** A box = a carrier tracking number with items allocated to it. */
export interface FbaBox {
  trackingId: number;
  trackingNumber: string;
  carrier: string;
  planId: number;
  items: FbaBoxItem[];
}

export interface FbaBoxItem {
  allocationId: number;
  planItemId: number;
  fnsku: string;
  qty: number;
}

// ── Shipment Card (composite view) ──────────────────────────────────────────

/** Read-only composite for rendering a shipment card in the UI. */
export interface FbaShipmentCard {
  plan: FbaPlan;
  items: FbaPlanItem[];
  boxes: FbaBox[];
  totalQty: number;
  isFullyTracked: boolean;
}

// ── Condense result ─────────────────────────────────────────────────────────

export type CondenseAction = 'condensed' | 'incremented' | 'created';

export interface AddFnskuResult {
  action: CondenseAction;
  itemId: number;
  newQty: number;
  /** Set when action is 'condensed' — the plan the item was moved from. */
  fromPlanId?: number;
}
