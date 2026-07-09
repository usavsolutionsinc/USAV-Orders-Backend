/**
 * Cache tag registry (Phase 0.7).
 *
 * A typed catalog of the cache tag names in use, mirroring `src/queries/keys.ts`
 * for the client. Tag *values* here are the bare names; the cache layer
 * org-scopes them (`cache_tags:v2:{tag}:{orgId}`). Centralizing the strings
 * prevents the "stringly-typed invalidation silently stops matching" class of bug.
 *
 * Every cached read declares its tags from here; every writer invalidates via
 * `invalidateCacheTags(orgId, [CACHE_TAGS.x])` at the route chokepoint.
 */
export const CACHE_TAGS = {
  // ── Orders / fulfillment ──────────────────────────────────────────────────
  orders: 'orders',
  ordersNext: 'orders-next',
  shipped: 'shipped',
  packingLogs: 'packing-logs',

  // ── Receiving ─────────────────────────────────────────────────────────────
  receivingLines: 'receiving-lines',
  receivingLogs: 'receiving-logs',
  pendingUnboxing: 'pending-unboxing',

  // ── Tech / repair ─────────────────────────────────────────────────────────
  techLogs: 'tech-logs',
  repairService: 'repair-service',

  // ── Staff ─────────────────────────────────────────────────────────────────
  staff: 'staff',
  /** Per-staff overrides (name/role/added-removed perms/mobile cfg) — the auth
   *  hot-path read. Purged on staff PATCH so a permission revocation is immediate. */
  staffOverrides: 'staff-overrides',

  // ── Reference data (Phase 1 targets) ──────────────────────────────────────
  skuCatalog: 'sku-catalog',
  skuStock: 'sku-stock',
  productManuals: 'product-manuals',
  fbaFnskus: 'fba-fnskus',
  skuKitParts: 'sku-kit-parts',
  qcChecks: 'qc-checks',
  reasonCodes: 'reason-codes',
  /** Per-org platform/account/type catalog (org-catalog.ts L1 Map + Redis L2). */
  catalog: 'org-catalog',

  // ── Station read models (Phase 2 targets) ─────────────────────────────────
  orderDetail: 'order-detail',
  fbaBoard: 'fba-board',
  fbaToday: 'fba-today',
  fbaStageCounts: 'fba-stage-counts',
  poByRef: 'po-by-ref',
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/**
 * Cache namespaces (the `ns` argument). Kept alongside the tags so the
 * per-namespace kill-switch allowlist (REDIS_CACHE_NS) references stable names.
 */
export const CACHE_NS = {
  titleBySku: 'title-by-sku',
  skuStock: 'sku-stock',
  manual: 'manual',
  fnskuCatalog: 'fnsku-catalog',
  skuKit: 'sku-kit',
  skuQc: 'sku-qc',
  skuByGtin: 'sku-by-gtin',
  reasons: 'reasons',
  orderDetail: 'order-detail',
  fbaToday: 'fba-today',
  fbaBoard: 'fba-board',
  packPolicy: 'pack-policy',
  poByRef: 'po-by-ref',
  staffOverrides: 'staff-ovr',
  opsDashboard: 'ops-dashboard',
  catalog: 'catalog',
} as const;

export type CacheNamespace = (typeof CACHE_NS)[keyof typeof CACHE_NS];
