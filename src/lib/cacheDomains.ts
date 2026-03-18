/**
 * Central registry of all cache domains used across the app.
 *
 * Always reference these constants instead of raw strings to prevent typos
 * and make refactoring safe.
 *
 * TTL guidance (per domain):
 *   - High-churn data (orders, packing logs): 2–5 minutes
 *   - Reference data (staff, SKUs): 15–30 minutes
 *   - Static/config data (settings): 60 minutes or null (permanent until logout)
 */

export const CACHE_DOMAINS = {
  // ─── Orders ────────────────────────────────────────────────────────────────
  ORDER: 'order',
  ORDERS_LIST: 'orders-list',
  ORDER_ASSIGNMENT: 'order-assignment',

  // ─── Packing / Shipping ─────────────────────────────────────────────────────
  PACKER_LOG: 'packer-log',
  SHIPPED: 'shipped',
  SHIPPED_LIST: 'shipped-list',

  // ─── Repairs ────────────────────────────────────────────────────────────────
  REPAIR: 'repair',
  REPAIRS_LIST: 'repairs-list',

  // ─── Receiving ──────────────────────────────────────────────────────────────
  RECEIVING: 'receiving',
  RECEIVING_LIST: 'receiving-list',
  RECEIVING_LINE: 'receiving-line',

  // ─── SKU / Inventory ────────────────────────────────────────────────────────
  SKU: 'sku',
  SKU_LIST: 'sku-list',
  SKU_STOCK: 'sku-stock',

  // ─── Staff ──────────────────────────────────────────────────────────────────
  STAFF: 'staff',
  STAFF_MAP: 'staff-map',
  STAFF_GOALS: 'staff-goals',

  // ─── FBA ────────────────────────────────────────────────────────────────────
  FBA_SHIPMENT: 'fba-shipment',
  FBA_LIST: 'fba-list',

  // ─── Tech / Station ─────────────────────────────────────────────────────────
  TECH_LOG: 'tech-log',
  STATION_HISTORY: 'station-history',

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  DASHBOARD: 'dashboard',
  DASHBOARD_WEEK: 'dashboard-week',

  // ─── Misc ───────────────────────────────────────────────────────────────────
  SETTINGS: 'settings',
  PRODUCT_MANUAL: 'product-manual',
  WORK_ORDER: 'work-order',
} as const;

export type CacheDomain = (typeof CACHE_DOMAINS)[keyof typeof CACHE_DOMAINS];

/** TTL constants in milliseconds for common use cases. */
export const CACHE_TTL = {
  SHORT: 2 * 60 * 1000,    // 2 min  — live/real-time feeds
  DEFAULT: 5 * 60 * 1000,  // 5 min  — standard data
  MEDIUM: 15 * 60 * 1000,  // 15 min — reference data (staff, SKUs)
  LONG: 30 * 60 * 1000,    // 30 min — slow-changing data
  HOUR: 60 * 60 * 1000,    // 1 hr   — config / settings
  PERMANENT: null,           // never expires
} as const;
