/**
 * `ReceivingLineRow` — the canonical receiving-line row shape returned by
 * /api/receiving-lines and consumed across the receiving/station/sidebar UI.
 *
 * Extracted out of `ReceivingLinesTable.tsx` into this leaf module so that
 * low-level utilities (e.g. `utils/events.ts`) and lib helpers can reference
 * the type WITHOUT importing the heavy table component — which previously
 * created import cycles (utils → component → … → utils). `ReceivingLinesTable`
 * re-exports this type for backwards compatibility, so existing importers are
 * unaffected.
 */
export interface ReceivingLineRow {
  id: number;
  receiving_id: number | null;
  /**
   * Client-minted identity for an OPTIMISTIC scan row (the triage "importing"
   * stub). Carries across the stub → resolved-row reconcile so the sidebar rail
   * keys both renders by the same value (see SidebarRailShell `getReconcileId`)
   * and updates the row IN PLACE instead of unmount+remount. Absent on every
   * server-fetched row — those fall back to keying by `id`.
   */
  client_event_id?: string;
  tracking_number: string | null;
  /** Legacy Zoho PO reference#/tracking text on the line (pickup placeholder detection). */
  zoho_reference_number?: string | null;
  tracking_source?: 'shipment' | 'receiving' | 'zoho_reference' | null;
  carrier: string | null;
  shipment_status?: string | null;
  is_delivered?: boolean;
  delivered_at?: string | null;
  zoho_item_id: string | null;
  zoho_line_item_id: string | null;
  zoho_purchase_receive_id: string | null;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  item_name: string | null;
  /** The Zoho item's own title (items.name, canonical product SoT). ALWAYS preferred for display — the PO line's item_name is a listing-style per-receipt title, not the product title. Null only when the line has no Zoho item. */
  zoho_item_title?: string | null;
  /** Canonical Zoho catalog title (sku_catalog.product_title), joined by SKU. Prefer over item_name for display; null when the SKU isn't catalogued yet. */
  catalog_product_title?: string | null;
  /** Canonical sku_catalog.id for this line's SKU. Keys the SKU pairing surface; null when the SKU isn't catalogued yet. */
  sku_catalog_id?: number | null;
  sku: string | null;
  quantity_received: number;
  quantity_expected: number | null;
  qa_status: string;
  workflow_status: string | null;
  disposition_code: string;
  condition_grade: string;
  disposition_audit: unknown[];
  needs_test: boolean;
  assigned_tech_id: number | null;
  zoho_sync_source: string | null;
  zoho_last_modified_time: string | null;
  zoho_synced_at: string | null;
  receiving_type: string | null;
  /** Unfound-line intake classification (receiving_lines.intake_type): po | return | trade_in. Null on Zoho-matched lines. */
  intake_type?: string | null;
  /** Operator platform override on a manually-added unfound line (receiving_lines.source_platform_pill). Null on Zoho-matched lines. */
  source_platform_pill?: string | null;
  /**
   * Carton-level DEFAULT receiving type (receiving.intake_type): PO|RETURN|TRADE_IN.
   * The carton pill edits this; receiving_type above overrides per line.
   * Effective line type = receiving_type ?? carton_intake_type ?? 'PO'. Migration 2026-06-13b.
   */
  carton_intake_type?: string | null;
  notes: string | null;
  /** Zoho PO line description (read-only import); shown in the Zoho Notes tab. 2026-06-24. */
  zoho_notes?: string | null;
  /** Zoho PO line unit cost (read-only mirror of Zoho line.rate); pg numeric → string. 2026-06-24. */
  unit_price?: string | null;
  /** Carton-level support notes from `receiving.support_notes` (same for all lines on the package). */
  receiving_support_notes?: string | null;
  /** Carton-level OVERALL Zoho PO note (`receiving.zoho_notes`, from the Zoho PO header).
   *  The Zoho Notes tab's primary content; distinct from the per-line `zoho_notes` (item desc). */
  receiving_zoho_notes?: string | null;
  /** Carton-level listing URL from `receiving.listing_url` (same for all lines on the package). */
  receiving_listing_url?: string | null;
  /**
   * Derived faceted bucket for `view=incoming` — computed on read from the
   * carrier status on shipping_tracking_numbers (DELIVERED_UNOPENED,
   * ARRIVING_TODAY, STALLED, IN_TRANSIT, PENDING_CARRIER, AWAITING_TRACKING).
   * Null on other views.
   */
  delivery_state?:
    | 'DELIVERED_UNOPENED'
    | 'DELIVERED_NOT_UNBOXED'
    | 'DELIVERED_EMAIL'
    | 'ARRIVING_TODAY'
    | 'STALLED'
    | 'IN_TRANSIT'
    | 'TRACKING_UNAVAILABLE'
    | 'PENDING_CARRIER'
    | 'CARRIER_MISMATCH'
    | 'AWAITING_TRACKING'
    | 'WRONG_DESTINATION'
    | 'RECEIVED'
    | 'UNKNOWN'
    | null;
  /** Carrier last event timestamp (Incoming). */
  shipment_latest_event_at?: string | null;
  /** Last successful carrier poll (Incoming). */
  shipment_last_checked_at?: string | null;
  /** Latest carrier event city (Incoming). */
  shipment_latest_event_city?: string | null;
  /** Latest carrier event postal (Incoming) — wrong-destination compare. */
  shipment_latest_event_postal?: string | null;
  /** True when delivered event postal ≠ warehouse ship-from. */
  wrong_destination?: boolean;
  /**
   * Tracking provenance for Incoming chips:
   * - `carrier_confirmed` — STN has been polled (last_checked_at or status)
   * - `seller_reported` — tracking text present but carrier never answered
   */
  tracking_confidence?: 'carrier_confirmed' | 'seller_reported' | null;
  /** Zoho PO date (`zoho_po_mirror.po_date`) — when the buyer authored the PO upstream (Incoming view only). */
  po_date?: string | null;
  /** Vendor-promised delivery date from zoho_po_mirror (Incoming view only). */
  expected_delivery_date?: string | null;
  /** Vendor name from zoho_po_mirror (Incoming view only). */
  vendor_name?: string | null;
  /**
   * Universal Incoming purchase identity (receiving_lines spine cache; Incoming
   * view only). `inbound_source_type` badges the row's source ('zoho' | 'ebay' | …);
   * `source_order_id` is the external order id (the eBay order#) shown when the
   * line has no Zoho PO; `platform_account_*` name the buyer/storefront account
   * the purchase was made on. Null on plain Zoho lines / other views.
   */
  inbound_source_type?: string | null;
  source_order_id?: string | null;
  platform_account_id?: number | null;
  platform_account_label?: string | null;
  /**
   * Zoho PO mirror status (`zoho_po_mirror.status`) — incoming + scanned views.
   * Phase 2: when terminal (received/closed/billed/cancelled) the row is badged
   * "Zoho: received" instead of being hidden, so a physically-present box stays
   * actionable while the financial-state mismatch is visible.
   */
  zoho_status?: string | null;
  created_at: string | null;
  /** Last write to the line row itself (qty bump, condition, notes, …).
   *  Drives the unbox rail's sort + time label (sort=unbox_activity). */
  updated_at?: string | null;
  /** Most-recent scan/receive time. Server sorts view=recent/all by this. */
  last_activity_at?: string | null;
  /** Door-scan ("scanned at") timestamp — receiving.received_at (view=recent/all/received). */
  received_at?: string | null;
  /** Staff who recorded the door scan (receiving.received_by → staff.name). */
  received_by_name?: string | null;
  /** Unbox timestamp — receiving.unboxed_at; null until the carton is unboxed. */
  unboxed_at?: string | null;
  /** Terminal "Received" (DONE) transition time — receiving_lines.received_done_at;
   *  null until the line is fully received. Distinct from received_at (door scan). */
  received_done_at?: string | null;
  /** Moment the carton was first opened on the Unbox surface
   *  (receiving.unbox_opened_at, or the UNBOX_SCAN_OPENED ops_event). This is the
   *  unbox rail's time-label + sort axis — the SAME value the right-pane Overview
   *  shows as "Opened for unbox". Distinct from received_at (door scan) and
   *  scanned_at (first physical scan). Null until the carton is opened in Unbox. */
  unbox_opened_at?: string | null;
  /** Staff who unboxed (receiving.unboxed_by → staff.name). */
  unboxed_by_name?: string | null;
  /** First tracking scan time (receiving_scans, earliest). */
  scanned_at?: string | null;
  /** Staff who first scanned the tracking (receiving_scans.scanned_by → staff.name). */
  scanned_by_name?: string | null;
  /**
   * Count of recorded testing verdicts for this line (view=testing only;
   * null on other views). Scoped to the tester when the feed is. Drives the
   * Testing rail's "tested k/N" without re-deriving from workflow_status.
   */
  tested_count?: number | null;
  image_url: string | null;
  source_platform: string | null;
  /** Shared unbox/test urgency flag (receiving.is_priority) — rank-0 in the Prioritize sort. */
  is_priority?: boolean | null;
  /** Manual priority-tier override (receiving.priority_tier): null = Auto, 0..3 = Priority/High/Medium/Low. */
  priority_tier?: number | null;
  /**
   * receiving.source — 'zoho_po' | 'unmatched' | 'local_pickup'.
   * Drives which workspace variant mounts (LineEditPanel vs UnfoundLineEditPanel).
   * Optional so callers that don't fetch from /api/receiving-lines still typecheck.
   */
  receiving_source?: string | null;
  /**
   * Saved serial_units for this line. `current_status` reflects the
   * unit's lifecycle position (RECEIVED → IN_TEST → TESTED / ON_HOLD …)
   * and drives the per-unit testing verdict pills in the tech workspace.
   */
  serials?: Array<{
    id: number;
    serial_number: string;
    current_status?: string;
    condition_grade?: string | null;
    /** Handling-unit (H-#### tote) this unit currently sits in, if any. */
    handling_unit_id?: number | null;
    /** Minted unit identity; presence = the unit has been labeled at least once. */
    unit_uid?: string | null;
  }> | null;
  /** Count of photos attached to this line's carton (from photos table, entity_type='RECEIVING'). */
  photo_count?: number;
  /** Filed Zendesk ticket # for this line (receiving_lines.zendesk_ticket), stored as "#<id>". */
  zendesk_ticket?: string | null;
  /** Triage staging shelf/lane — `receiving.staging_location_id`, FK into `locations`. Null until Phase 2's shelf picker ships. */
  staging_location_id?: number | null;
  /** Triage priority lane — `receiving.priority_lane` (see triage-lane-policy.ts). Null until Phase 2's lane picker ships. */
  priority_lane?: string | null;
  /** Triage pairing-hub outcome — `receiving.pairing_state`: UNFOUND | MATCHED | WAIVED. */
  pairing_state?: string | null;
  /** `receiving.triage_complete` — set by the real "Save for unbox" transition. Not threaded onto every feed yet; see TriageProgressStepper's client-tracked fallback. */
  triage_complete?: boolean | null;
  /** `receiving.triage_completed_at` — when the carton was staged/saved for unbox. */
  triage_completed_at?: string | null;
  /** Carton first opened on Unbox with no prior triage door scan. */
  unbox_only_intake?: boolean;
  /** Server stamp when operator explicitly picked condition_grade. */
  condition_set_at?: string | null;
  /**
   * Rail fetcher stamp — line + distinct-SKU counts for adaptive title mode
   * (unbox Recent per-carton; door-scan per-PO). Set client-side only.
   */
  rail_title_context?: {
    line_count: number;
    distinct_sku_count: number;
  };
}
