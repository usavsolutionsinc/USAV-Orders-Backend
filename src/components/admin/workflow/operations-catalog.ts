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

export interface OpsFlow {
  key: string;
  label: string;
  color: string;
  blurb: string;
  stations: string[];
  /** The modules / routes in the codebase that actually implement this flow. */
  code: string[];
  /** Ordered board node ids the flow passes through (incl. branches). */
  states: string[];
  steps: { state: string; station: string; note: string; signal?: string }[];
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
    blurb: 'From a carton on the dock to a tested, stocked unit.',
    stations: ['RECEIVING', 'TECH'],
    code: ['src/lib/receiving', '/api/receiving-lines', '/api/serial-units/[id]/test', 'src/lib/tech'],
    states: ['EXPECTED', 'ARRIVED', 'MATCHED', 'UNBOXED', 'RECEIVED', 'IN_TEST', 'TESTED', 'ON_HOLD', 'STOCKED'],
    steps: [
      { state: 'EXPECTED', station: 'RECEIVING', note: 'PO/order says the box is coming' },
      { state: 'ARRIVED', station: 'RECEIVING', note: 'carton scanned in', signal: 'TRACKING_SCANNED' },
      { state: 'MATCHED', station: 'RECEIVING', note: 'matched to a PO/order', signal: 'WS_RECEIVING_CHANGED' },
      { state: 'UNBOXED', station: 'RECEIVING', note: 'opened; contents confirmed', signal: 'WS_RECEIVING_CHANGED' },
      { state: 'RECEIVED', station: 'RECEIVING', note: 'serial unit created', signal: 'SERIAL_ADDED' },
      { state: 'IN_TEST', station: 'TECH', note: 'on the test bench', signal: 'TEST_START' },
      { state: 'TESTED', station: 'TECH', note: 'PASS verdict → ready to stock', signal: 'TEST_PASS' },
      { state: 'ON_HOLD', station: 'TECH', note: 'FAIL → routed to repair/returns', signal: 'TEST_FAIL' },
      { state: 'STOCKED', station: 'RECEIVING', note: 'put away into a bin', signal: 'PUTAWAY' },
    ],
  },
  {
    key: 'shipping',
    label: 'Shipping / outbound flow',
    color: '#6366f1',
    blurb: 'From a stocked unit to a shipped customer order.',
    stations: ['PACK', 'LABELS', 'FBA'],
    code: ['/api/orders/[id]/allocate', '/api/orders/[id]/pick-tasks', 'src/lib/picking', 'src/lib/shipping'],
    states: ['STOCKED', 'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'SHIPPED'],
    steps: [
      { state: 'STOCKED', station: 'PACK', note: 'available stock' },
      { state: 'ALLOCATED', station: 'PACK', note: 'reserved to an order', signal: 'ALLOCATED' },
      { state: 'PICKED', station: 'PACK', note: 'pulled from the bin' },
      { state: 'PACKED', station: 'PACK', note: 'packed into a box/shipment', signal: 'PACK_COMPLETED' },
      { state: 'LABELED', station: 'LABELS', note: 'outbound tracking minted', signal: 'LABEL_PRINTED' },
      { state: 'SHIPPED', station: 'FBA', note: 'handed to the carrier' },
    ],
  },
  {
    key: 'fba',
    label: 'FBA flow',
    color: '#f59e0b',
    blurb: 'Stocked unit → FNSKU-labeled → inbound FBA shipment → Amazon.',
    stations: ['FBA', 'LABELS'],
    code: ['src/lib/fba', '/api/fba'],
    states: ['STOCKED', 'ALLOCATED', 'LABELED', 'SHIPPED'],
    steps: [
      { state: 'STOCKED', station: 'FBA', note: 'eligible stock selected for FBA' },
      { state: 'ALLOCATED', station: 'FBA', note: 'tied to an FBA plan', signal: 'WS_FBA_SCAN' },
      { state: 'LABELED', station: 'LABELS', note: 'FNSKU label printed', signal: 'FNSKU_SCANNED' },
      { state: 'SHIPPED', station: 'FBA', note: 'shipment sent to Amazon', signal: 'FBA_READY' },
    ],
  },
  {
    key: 'repair',
    label: 'Repair flow',
    color: '#f97316',
    blurb: 'A failed test routes to triage, repair, and re-test.',
    stations: ['TECH'],
    code: ['src/lib/repair', 'repair_service table'],
    states: ['ON_HOLD', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST', 'TESTED'],
    steps: [
      { state: 'ON_HOLD', station: 'TECH', note: 'failed testing', signal: 'TEST_FAIL' },
      { state: 'TRIAGED', station: 'TECH', note: 'issue diagnosed', signal: 'WS_REPAIR_CHANGED' },
      { state: 'IN_REPAIR', station: 'TECH', note: 'being repaired', signal: 'WS_REPAIR_CHANGED' },
      { state: 'REPAIR_DONE', station: 'TECH', note: 'repair complete', signal: 'WS_REPAIR_CHANGED' },
      { state: 'IN_TEST', station: 'TECH', note: 're-tested', signal: 'TEST_START' },
      { state: 'TESTED', station: 'TECH', note: 'passes → back to stock', signal: 'TEST_PASS' },
    ],
  },
  {
    key: 'returns',
    label: 'Returns / RMA flow',
    color: '#f43f5e',
    blurb: 'A shipped item comes back, gets inspected, and is restocked or scrapped.',
    stations: ['RECEIVING', 'TECH'],
    code: ['src/lib/rma', '/api/orders-exceptions', 'orders_exceptions table'],
    states: ['SHIPPED', 'RETURNED', 'RMA', 'IN_TEST', 'STOCKED', 'SCRAPPED'],
    steps: [
      { state: 'SHIPPED', station: 'RECEIVING', note: 'item was shipped' },
      { state: 'RETURNED', station: 'RECEIVING', note: 'customer return received' },
      { state: 'RMA', station: 'TECH', note: 'RMA opened / inspected' },
      { state: 'IN_TEST', station: 'TECH', note: 're-tested', signal: 'TEST_START' },
      { state: 'STOCKED', station: 'RECEIVING', note: 'restocked if good', signal: 'PUTAWAY' },
      { state: 'SCRAPPED', station: 'TECH', note: 'scrapped if not' },
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

  if (found.category === 'flow') return new Set((found.item as OpsFlow).states);
  if (found.category === 'station') return new Set((found.item as OpsStation).states);

  // Identifier → union the states of every station that handles it.
  const id = found.item as OpsIdentifier;
  const states = new Set<string>();
  for (const st of STATIONS) {
    if (st.handles.includes(id.key)) st.states.forEach((s) => states.add(s));
  }
  return states.size ? states : null;
}
