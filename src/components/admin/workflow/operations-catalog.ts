/**
 * Operations catalog — the reference content behind the Operations sidebar.
 *
 * A hand-curated, schema-grounded map of the real system: the STATIONS work
 * happens at, the IDENTIFIERS that travel through it (tracking numbers, serial
 * numbers, Zoho SKUs, order numbers, FNSKUs…), and the FLOWS that string the
 * lifecycle states together (receiving, shipping, FBA, repair, returns).
 *
 * Station names + activity types are the REAL values observed in
 * station_activity_logs / inventory_events. Table refs point at the columns
 * that actually hold each identifier so the sidebar doubles as a data map.
 *
 * The lifecycle `states` use the same keys as the flow-audit board nodes
 * (serial_status_enum + the receiving workflow states), so selecting an item
 * can highlight its path on the canvas.
 */

export type OpsCategory = 'flow' | 'station' | 'identifier';

export interface OpsStation {
  key: string;
  label: string;
  color: string;
  blurb: string;
  /** Real station_activity_logs.activity_type values seen at this station. */
  activityTypes: string[];
  /** Identifier keys this station reads or writes. */
  handles: string[];
  /** Board node ids (lifecycle states) this station owns. */
  states: string[];
}

export interface OpsIdentifier {
  key: string;
  label: string;
  example: string;
  blurb: string;
  /** Where the value actually lives: `table.column`. */
  tables: string[];
  /** Its journey through the system, station by station. */
  travels: { station: string; note: string }[];
  /** Other identifier keys it links to. */
  relatedTo: string[];
}

export interface OpsFlowStep {
  /** Display label exactly as the real UI shows it (e.g. "Combined"). */
  stage: string;
  /** The real status key / enum value backing it (e.g. LABEL_ASSIGNED), if any. */
  key?: string;
  /** Owning station. */
  station: string;
  /** One-line meaning. */
  note: string;
  /** Real activity / event type that marks this step. */
  signal?: string;
  /** The route / function that performs the transition. */
  by?: string;
}

export interface OpsFlow {
  key: string;
  label: string;
  color: string;
  blurb: string;
  stations: string[];
  /** Where the status vocabulary is defined (file · enum/column). */
  source: string;
  /** The modules / routes in the codebase that actually implement this flow. */
  code: string[];
  steps: OpsFlowStep[];
  /** Off-happy-path / terminal branches (failures, cancels, carrier statuses). */
  offPath?: { stage: string; note: string }[];
}

// ─── Stations ────────────────────────────────────────────────

export const STATIONS: OpsStation[] = [
  {
    key: 'RECEIVING',
    label: 'Receiving',
    color: '#3b82f6',
    blurb:
      'Inbound dock. Scans the incoming carton, matches it to a PO / order, unboxes it, and creates one serial unit per item.',
    activityTypes: ['WS_RECEIVING_CHANGED', 'TRACKING_SCANNED', 'SERIAL_ADDED'],
    handles: ['receivingTracking', 'serial', 'sku', 'zohoItem', 'conditionGrade', 'binLocation'],
    states: ['EXPECTED', 'ARRIVED', 'MATCHED', 'UNBOXED', 'RECEIVED'],
  },
  {
    key: 'TECH',
    label: 'Tech / Test',
    color: '#22c55e',
    blurb:
      'Test & QC bench. Runs the unit through testing, records a PASS / TEST_AGAIN / FAIL verdict and a condition grade.',
    activityTypes: ['SERIAL_ADDED', 'WS_ORDER_TESTED', 'WS_REPAIR_CHANGED'],
    handles: ['serial', 'conditionGrade', 'sku'],
    states: ['IN_TEST', 'TESTED', 'GRADED', 'ON_HOLD', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE'],
  },
  {
    key: 'PACK',
    label: 'Pack',
    color: '#6366f1',
    blurb:
      'Pack bench. Allocates stock to an order, scans units into a box/shipment, and completes packing.',
    activityTypes: ['PACK_COMPLETED', 'PACK_SCAN'],
    handles: ['serial', 'shipmentId', 'orderNumber', 'sku'],
    states: ['ALLOCATED', 'PICKED', 'PACKED'],
  },
  {
    key: 'LABELS',
    label: 'Labels',
    color: '#8b5cf6',
    blurb: 'Label printing. Prints the outbound carrier label and/or the FNSKU label for a unit or shipment.',
    activityTypes: ['LABEL_PRINTED'],
    handles: ['shippingTracking', 'fnsku', 'shipmentId'],
    states: ['LABELED'],
  },
  {
    key: 'FBA',
    label: 'FBA prep',
    color: '#f59e0b',
    blurb: 'Amazon FBA prep. Scans FNSKUs and builds the inbound-to-Amazon FBA shipment.',
    activityTypes: ['FBA_READY', 'WS_FBA_SCAN', 'FNSKU_SCANNED'],
    handles: ['fnsku', 'fbaShipmentId', 'sku', 'shippingTracking'],
    states: ['SHIPPED'],
  },
  {
    key: 'ADMIN',
    label: 'Admin / System',
    color: '#64748b',
    blurb:
      'Back-office and automated actors (SYSTEM, BACKFILL, MOBILE). Corrections, Zoho syncs, and data backfills land here.',
    activityTypes: [],
    handles: ['orderNumber', 'zohoItem', 'sku'],
    states: ['UNKNOWN'],
  },
];

// ─── Identifiers (the information that travels) ───────────────

export const IDENTIFIERS: OpsIdentifier[] = [
  {
    key: 'serial',
    label: 'Serial number',
    example: 'SN-4F19A23B',
    blurb:
      "The physical unit's unique identity. Normalized on capture; the test verdict, location, shipment, and order all hang off it.",
    tables: [
      'serial_units.serial_number',
      'serial_units.normalized_serial',
      'tech_serial_numbers.serial_number',
    ],
    travels: [
      { station: 'RECEIVING', note: 'SERIAL_ADDED creates the serial_units row' },
      { station: 'TECH', note: 'test verdict → current_status TESTED / ON_HOLD' },
      { station: 'PACK', note: 'scanned into a shipment' },
      { station: 'LABELS', note: 'label printed against the unit' },
    ],
    relatedTo: ['sku', 'shipmentId', 'shippingTracking', 'zohoItem', 'conditionGrade'],
  },
  {
    key: 'receivingTracking',
    label: 'Inbound tracking #',
    example: '1Z999… / 9400 1…',
    blurb:
      'Carrier tracking of the carton that arrived. Scanned at the dock to open or attach a receiving record.',
    tables: ['receiving.receiving_tracking_number', 'station_activity_logs.scan_ref (TRACKING_SCANNED)'],
    travels: [
      { station: 'RECEIVING', note: 'TRACKING_SCANNED matches the box to a receiving record' },
    ],
    relatedTo: ['serial', 'orderNumber'],
  },
  {
    key: 'shippingTracking',
    label: 'Outbound tracking #',
    example: '1Z999… / 9400 1…',
    blurb: 'Carrier tracking of the box you ship out. Printed at Labels, tied to the shipment + order.',
    tables: [
      'serial_units.shipping_tracking_number',
      'shipping_tracking_numbers',
      'fba_shipment_tracking',
    ],
    travels: [
      { station: 'LABELS', note: 'LABEL_PRINTED mints the outbound tracking #' },
      { station: 'FBA', note: 'FBA shipments carry their own tracking' },
    ],
    relatedTo: ['shipmentId', 'orderNumber', 'serial', 'fbaShipmentId'],
  },
  {
    key: 'sku',
    label: 'SKU / item code',
    example: 'BOSE-QC45-BLK',
    blurb:
      'Product identity — what the unit IS. Bridges the physical unit to the catalog and Zoho inventory.',
    tables: ['serial_units.sku', 'sku_catalog.sku', 'sku_platform_ids', 'items.sku'],
    travels: [
      { station: 'RECEIVING', note: 'set when the unit is matched to a catalog item' },
      { station: 'PACK', note: 'allocation/pick is by SKU' },
      { station: 'FBA', note: 'mapped to an FNSKU for Amazon' },
    ],
    relatedTo: ['zohoItem', 'serial', 'orderNumber', 'fnsku'],
  },
  {
    key: 'zohoItem',
    label: 'Zoho SKU / item id',
    example: 'zoho_item_id 4567…',
    blurb:
      "Zoho Inventory's internal id for the SKU — the sync key that keeps stock counts and sales orders aligned with Zoho.",
    tables: ['serial_units.zoho_item_id', 'sku_catalog', 'zoho_fulfillment_sync', 'zoho_locations'],
    travels: [
      { station: 'ADMIN', note: 'SYSTEM sync reconciles stock + SOs with Zoho' },
    ],
    relatedTo: ['sku', 'orderNumber'],
  },
  {
    key: 'orderNumber',
    label: 'Order # / Sales order',
    example: 'SO-01042 / eBay 12-…',
    blurb:
      'The customer order. Drives allocation → pick → pack → ship. Carries the eBay/Zoho sales-order numbers.',
    tables: ['orders', 'sales_orders', 'order_shipment_links', 'shipment_orders'],
    travels: [
      { station: 'ADMIN', note: 'order synced in from marketplace / Zoho' },
      { station: 'PACK', note: 'allocated + packed against the order' },
      { station: 'LABELS', note: 'label printed for the order' },
    ],
    relatedTo: ['sku', 'shipmentId', 'shippingTracking', 'zohoItem'],
  },
  {
    key: 'shipmentId',
    label: 'Shipment id',
    example: 'shipment_id 88231',
    blurb: 'Groups units and packages into one outbound shipment.',
    tables: [
      'serial_units.shipment_id',
      'station_activity_logs.shipment_id',
      'shipment_orders',
      'packages',
    ],
    travels: [
      { station: 'PACK', note: 'units scanned into the shipment' },
      { station: 'LABELS', note: 'shipment gets a carrier label' },
    ],
    relatedTo: ['orderNumber', 'shippingTracking', 'serial'],
  },
  {
    key: 'fnsku',
    label: 'FNSKU',
    example: 'X0019ABCDE',
    blurb: "Amazon's fulfillment SKU/barcode for an FBA unit. Maps a SKU to Amazon's catalog.",
    tables: ['fba_fnskus.fnsku', 'station_activity_logs.fnsku', 'fba_fnsku_logs'],
    travels: [
      { station: 'FBA', note: 'FNSKU_SCANNED ties the unit to an FBA plan' },
      { station: 'LABELS', note: 'FNSKU label printed' },
    ],
    relatedTo: ['sku', 'fbaShipmentId'],
  },
  {
    key: 'fbaShipmentId',
    label: 'FBA shipment',
    example: 'FBA15ABCDE',
    blurb: 'An inbound-to-Amazon FBA shipment that aggregates FNSKU units.',
    tables: ['fba_shipments', 'fba_shipment_items', 'fba_shipment_tracking', 'fba_tracking_item_allocations'],
    travels: [
      { station: 'FBA', note: 'FBA_READY closes out the shipment' },
    ],
    relatedTo: ['fnsku', 'shippingTracking'],
  },
  {
    key: 'scanRef',
    label: 'Scan ref / token',
    example: 'raw scanned value',
    blurb:
      'The raw scanned value behind a station event — could be a tracking #, serial, or FNSKU — that ties a scan to its context. Also the idempotency token for mobile scans.',
    tables: [
      'station_activity_logs.scan_ref',
      'inventory_events.scan_token',
      'inventory_events.client_event_id',
    ],
    travels: [
      { station: 'RECEIVING', note: 'every dock scan' },
      { station: 'TECH', note: 'serial scans' },
      { station: 'PACK', note: 'pack scans' },
      { station: 'FBA', note: 'FNSKU scans' },
    ],
    relatedTo: ['serial', 'receivingTracking', 'fnsku'],
  },
  {
    key: 'binLocation',
    label: 'Bin / location',
    example: 'A-12-3',
    blurb: 'Where the unit physically sits after putaway.',
    tables: ['locations', 'bin_contents', 'serial_units.current_location', 'location_transfers'],
    travels: [
      { station: 'RECEIVING', note: 'PUTAWAY → STOCKED into a bin' },
    ],
    relatedTo: ['serial', 'sku'],
  },
  {
    key: 'conditionGrade',
    label: 'Condition grade',
    example: 'BRAND_NEW … SCRAP',
    blurb: 'The graded condition set at receiving / tech; history is tracked per change.',
    tables: [
      'serial_units.condition_grade',
      'serial_unit_condition_history',
      'receiving.condition_grade',
    ],
    travels: [
      { station: 'RECEIVING', note: 'initial grade on intake' },
      { station: 'TECH', note: 'regraded after testing' },
    ],
    relatedTo: ['serial'],
  },
];

// ─── Flows ───────────────────────────────────────────────────

export const FLOWS: OpsFlow[] = [
  {
    key: 'receiving',
    label: 'Receiving flow',
    color: '#3b82f6',
    blurb: 'From a carton on the dock to a tested, finalized line. Stage = receiving_lines.workflow_status.',
    stations: ['RECEIVING', 'TECH'],
    source: 'inbound_workflow_status_enum · src/lib/receiving/workflow-stages.ts',
    code: ['src/lib/receiving/workflow-stages.ts', '/api/receiving/match', 'src/lib/receiving/receive-line.ts', '/api/serial-units/[id]/test'],
    steps: [
      { stage: 'Incoming', key: 'EXPECTED', station: 'RECEIVING', note: 'On a PO from Zoho — not yet scanned at the dock', signal: 'Zoho PO sync' },
      { stage: 'Scanned', key: 'ARRIVED', station: 'RECEIVING', note: 'Carton scanned in, not yet matched to a PO', signal: 'TRACKING_SCANNED' },
      { stage: 'Matched', key: 'MATCHED', station: 'RECEIVING', note: 'Line linked to a PO/order (shows as “Scanned” in tables)', signal: 'WS_RECEIVING_CHANGED', by: '/api/receiving/match' },
      { stage: 'Unboxed', key: 'UNBOXED', station: 'RECEIVING', note: 'Units counted out; qty_received ≥ qty_expected', signal: 'SERIAL_ADDED', by: 'receiveLineUnits' },
      { stage: 'Awaiting Test', key: 'AWAITING_TEST', station: 'TECH', note: 'Queued for QA (display state; row stays UNBOXED until first verdict)' },
      { stage: 'Testing', key: 'IN_TEST', station: 'TECH', note: 'A tech is actively testing the line', signal: 'TEST_START', by: '/api/serial-units/[id]/test' },
      { stage: 'Passed', key: 'PASSED', station: 'TECH', note: 'All units TESTED, no failures → ready to finalize', signal: 'TEST_PASS' },
      { stage: 'Done', key: 'DONE', station: 'RECEIVING', note: 'Line finalized, put away (shows as “Received”)', signal: 'PUTAWAY' },
    ],
    offPath: [
      { stage: 'Failed', note: 'Any unit ON_HOLD → FAILED / FAILED_FUNCTIONAL (claim flow)' },
      { stage: 'RTV', note: 'Disposition = return to vendor' },
      { stage: 'Scrap', note: 'Disposition = scrapped / claimed' },
    ],
  },
  {
    key: 'fba',
    label: 'FBA flow',
    color: '#f59e0b',
    blurb: 'Scan FNSKUs → Planned → Tested (ready to go) → Packed → Combined → Shipped. Stage = fba_shipment_items.status.',
    stations: ['FBA', 'TECH', 'PACK', 'LABELS'],
    source: 'fba_shipment_status_enum · src/lib/fba/status.ts',
    code: ['src/lib/fba/status.ts', '/api/tech/scan', '/api/fba/items/ready', '/api/fba/items/scan', '/api/fba/labels/bind', '/api/fba/shipments/mark-shipped'],
    steps: [
      { stage: 'Planned', key: 'PLANNED', station: 'FBA', note: 'FNSKU first scanned → added to today’s FBA plan', signal: 'FNSKU_SCANNED', by: '/api/tech/scan' },
      { stage: 'Tested', key: 'TESTED', station: 'TECH', note: 'Tech validated the unit — “ready to go” to the packer', signal: 'FBA_READY', by: '/api/fba/items/ready' },
      { stage: 'Packed', key: 'PACKED', station: 'PACK', note: 'Packer scanned the FNSKU into a box', signal: 'FBA_READY', by: '/api/fba/items/scan' },
      { stage: 'Combined', key: 'LABEL_ASSIGNED', station: 'LABELS', note: 'Shipping-label barcode bound — items combined under one FBA shipment', signal: 'ASSIGNED', by: '/api/fba/labels/bind' },
      { stage: 'Shipped', key: 'SHIPPED', station: 'PACK', note: 'UPS tracking scanned → carrier handoff; shipment auto-closes', by: '/api/fba/shipments/mark-shipped' },
    ],
    offPath: [
      { stage: 'Out of Stock', note: 'Marked unavailable during planning' },
      { stage: 'Closed', note: 'Plan / shipment archived' },
    ],
  },
  {
    key: 'shipping',
    label: 'Outbound order flow',
    color: '#6366f1',
    blurb: 'From a stocked unit to a shipped customer order. Stage = order_unit_allocations.state.',
    stations: ['PACK', 'LABELS'],
    source: 'order_unit_allocations.state + serial_status_enum',
    code: ['src/lib/inventory/allocate.ts', '/api/orders/[id]/allocate', '/api/pick/scan', '/api/pack/ship', 'src/lib/shipping'],
    steps: [
      { stage: 'Allocated', key: 'ALLOCATED', station: 'PACK', note: 'Stocked unit reserved to an order (FIFO)', signal: 'ALLOCATED', by: '/api/orders/[id]/allocate' },
      { stage: 'Picked', key: 'PICKED', station: 'PACK', note: 'Pulled from its bin', signal: 'PICKED', by: '/api/pick/scan' },
      { stage: 'Packed', key: 'PACKED', station: 'PACK', note: 'Scanned into a box at the pack station', signal: 'PACK_COMPLETED', by: '/api/pack/ship' },
      { stage: 'Labeled', key: 'LABELED', station: 'LABELS', note: 'Carrier label printed; tracking minted', signal: 'LABEL_PRINTED' },
      { stage: 'Shipped', key: 'SHIPPED', station: 'PACK', note: 'Handed to the carrier; orders.status = shipped', signal: 'SHIPPED', by: '/api/pack/ship' },
    ],
    offPath: [
      { stage: 'Released', note: 'Allocation unwound → unit returns to STOCKED' },
      { stage: 'Carrier: Accepted → In Transit → Out for Delivery → Delivered', note: 'Live carrier tracking on the Shipped page (ShipmentStatusBadge)' },
      { stage: 'UI buckets', note: 'Awaiting Tracking (no shipment_id) → Pending (label, no carrier scan) → Shipped (carrier accepted)' },
    ],
  },
  {
    key: 'repair',
    label: 'Repair flow',
    color: '#f97316',
    blurb: 'Walk-in / mail-in repair service. Free-text status with Incoming / Active / Done tabs.',
    stations: ['RECEIVING', 'TECH', 'ADMIN'],
    source: 'repair_service.status (free-text) · src/lib/neon/repair-service-queries.ts',
    code: ['src/lib/neon/repair-service-queries.ts', '/api/repair-service', '/api/repair-service/repaired'],
    steps: [
      { stage: 'Incoming Shipment', station: 'RECEIVING', note: 'Inbound repair awaiting intake (Incoming tab)' },
      { stage: 'Pending Repair', station: 'TECH', note: 'Default — queued for a technician', signal: 'WS_REPAIR_CHANGED' },
      { stage: 'Awaiting Parts', station: 'TECH', note: 'Blocked on part availability' },
      { stage: 'Repaired, Contact Customer', station: 'TECH', note: 'Work done — reach out to the customer', by: '/api/repair-service/repaired' },
      { stage: 'Awaiting Pickup / Payment', station: 'ADMIN', note: 'Done; awaiting customer pickup or payment' },
      { stage: 'Picked Up / Shipped', station: 'ADMIN', note: 'Closed out (Done tab)' },
    ],
    offPath: [{ stage: 'Cancelled', note: 'Soft-deleted; hidden from all tabs' }],
  },
  {
    key: 'returns',
    label: 'Returns / RMA flow',
    color: '#f43f5e',
    blurb: 'Customer return or vendor RTV; per-unit dispositions on receipt. Stage = rma_authorizations.status.',
    stations: ['ADMIN', 'RECEIVING', 'TECH'],
    source: 'rma_authorizations.status (enum) · src/lib/rma/authorizations.ts',
    code: ['src/lib/rma/authorizations.ts', '/api/rma', 'return_dispositions table', 'src/lib/orders-exceptions.ts'],
    steps: [
      { stage: 'Authorized', key: 'AUTHORIZED', station: 'ADMIN', note: 'RMA number issued; return expected (INBOUND_FROM_CUSTOMER or OUTBOUND_TO_VENDOR)' },
      { stage: 'Received', key: 'RECEIVED', station: 'RECEIVING', note: 'Return carton arrived at the warehouse', by: '/api/rma/[id]/mark-received' },
      { stage: 'Dispositioned', key: 'DISPOSITIONED', station: 'TECH', note: 'Per-unit verdict recorded: ACCEPT / HOLD / RTV / REWORK / SCRAP' },
      { stage: 'Closed', key: 'CLOSED', station: 'ADMIN', note: 'All units dispositioned; RMA finalized' },
    ],
    offPath: [
      { stage: 'Expired', note: 'Authorization lapsed past expires_at' },
      { stage: 'Canceled', note: 'Cancelled before receipt' },
      { stage: 'Unmatched return', note: 'orders_exceptions: open → resolved when return tracking matches an order' },
    ],
  },
];

// ─── Lookup + board-highlight helpers ────────────────────────

export function findCatalogItem(
  key: string | null,
): { category: OpsCategory; item: OpsFlow | OpsStation | OpsIdentifier } | null {
  if (!key) return null;
  const flow = FLOWS.find((f) => f.key === key);
  if (flow) return { category: 'flow', item: flow };
  const station = STATIONS.find((s) => s.key === key);
  if (station) return { category: 'station', item: station };
  const identifier = IDENTIFIERS.find((i) => i.key === key);
  if (identifier) return { category: 'identifier', item: identifier };
  return null;
}

/**
 * The set of board node ids to spotlight for a selected catalog key, or null
 * when nothing is selected (board shows everything at full strength).
 */
export function highlightStatesFor(key: string | null): Set<string> | null {
  const found = findCatalogItem(key);
  if (!found) return null;

  if (found.category === 'flow') {
    const keys = (found.item as OpsFlow).steps.map((s) => s.key).filter((k): k is string => !!k);
    return keys.length ? new Set(keys) : null;
  }
  if (found.category === 'station') return new Set((found.item as OpsStation).states);

  // Identifier → union the states of every station that handles it.
  const id = found.item as OpsIdentifier;
  const states = new Set<string>();
  for (const st of STATIONS) {
    if (st.handles.includes(id.key)) st.states.forEach((s) => states.add(s));
  }
  return states.size ? states : null;
}
