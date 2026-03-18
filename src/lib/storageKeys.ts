/**
 * Central registry of all localStorage keys used across the app.
 *
 * Rules:
 * 1. ALWAYS add new keys here — never use raw strings in components.
 * 2. Entity-scoped draft keys must include the entity ID to prevent cross-record pollution.
 * 3. Keep key names descriptive and grouped by feature.
 */

export const STORAGE_KEYS = {
  // ─── App Preferences ─────────────────────────────────────────────────────────
  THEME: 'app-theme',
  SIDEBAR_COLLAPSED: 'sidebar-collapsed',
  SIDEBAR_PANEL: 'sidebar-panel',

  // ─── Receiving ───────────────────────────────────────────────────────────────
  RECEIVING_DRAFT: 'receiving-draft',
  receivingLineDraft: (receivingId: string | number) => `receiving-line-draft:${receivingId}`,

  // ─── Repair ──────────────────────────────────────────────────────────────────
  REPAIR_DRAFT: 'repair-draft',
  repairEditDraft: (repairId: string | number) => `repair-edit-draft:${repairId}`,

  // ─── Orders ──────────────────────────────────────────────────────────────────
  orderEditDraft: (orderId: string | number) => `order-edit-draft:${orderId}`,

  // ─── FBA ─────────────────────────────────────────────────────────────────────
  FBA_SHIPMENT_DRAFT: 'fba-shipment-draft',
  fbaShipmentEditDraft: (shipmentId: string | number) => `fba-shipment-edit-draft:${shipmentId}`,

  // ─── Work Orders ─────────────────────────────────────────────────────────────
  WORK_ORDER_DRAFT: 'work-order-draft',
  workOrderEditDraft: (orderId: string | number) => `work-order-edit-draft:${orderId}`,

  // ─── SKU / Inventory ─────────────────────────────────────────────────────────
  skuEditDraft: (sku: string) => `sku-edit-draft:${sku}`,

  // ─── Dashboard ───────────────────────────────────────────────────────────────
  DASHBOARD_FILTERS: 'dashboard-filters',
  DASHBOARD_DATE_RANGE: 'dashboard-date-range',

  // ─── Station ─────────────────────────────────────────────────────────────────
  STATION_ACTIVE_ORDER: 'station-active-order',
  STATION_PACKER_ID: 'station-packer-id',
  STATION_TECH_ID: 'station-tech-id',
} as const;
