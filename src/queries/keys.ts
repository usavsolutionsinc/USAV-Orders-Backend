/**
 * Centralized React Query key factory.
 *
 * Cache keys were previously string literals duplicated across many files
 * (e.g. `['walk-in-sales', …]` and `['ebay-accounts']` each appear in 3+
 * places), so a typo silently breaks caching/invalidation. Define each key
 * here once; a query and its invalidations then import from the same source.
 *
 * Adoption is incremental — migrate call sites to these helpers as you touch
 * them, and add new keys here rather than inlining string literals. An `.all`
 * entry is the broad invalidation prefix (React Query matches keys by prefix).
 */
export const qk = {
  walkInSales: {
    /** Broad invalidation prefix — matches every walk-in-sales list query. */
    all: ['walk-in-sales'] as const,
    list: (search: string, weekStart: string, weekEnd: string, status: string) =>
      ['walk-in-sales', search, weekStart, weekEnd, status] as const,
  },
  ebayAccounts: ['ebay-accounts'] as const,
  amazonAccounts: ['amazon-accounts'] as const,
  adminFbaFnskus: {
    /** Broad invalidation prefix — matches every admin FNSKU directory query. */
    all: ['admin-fba-fnskus'] as const,
    list: (search: string) => ['admin-fba-fnskus', search] as const,
  },
  dashboardTable: {
    all: ['dashboard-table'] as const,
    pending: ['dashboard-table', 'pending'] as const,
    unshipped: ['dashboard-table', 'unshipped'] as const,
    shipped: ['dashboard-table', 'shipped'] as const,
    shippedFba: ['dashboard-table', 'shipped-fba'] as const,
  },
  shippedTable: ['shipped-table'] as const,
  dashboardStockZoho: ['dashboard-stock-zoho'] as const,
  dashboardFbaShipments: ['dashboard-fba-shipments'] as const,
  adminFeatures: {
    all: ['admin-features'] as const,
    list: (search: string, featureType: string, featureStatus: string, featureActive: string) =>
      ['admin-features', search, featureType, featureStatus, featureActive] as const,
  },
  reasonCodes: {
    /** Broad invalidation prefix — matches every reason-codes query. */
    all: ['reason-codes'] as const,
    list: () => ['reason-codes', 'list'] as const,
  },
  fba: {
    board: ['fba-board'] as const,
    stageCounts: ['fba-stage-counts'] as const,
    queue: ['fba-queue'] as const,
    logs: ['fba-logs'] as const,
    shipments: ['fba-shipments'] as const,
    fnskus: ['fba-fnskus'] as const,
    fnskuSearch: (q: string) => ['fba-fnskus', 'search', q] as const,
  },
  staff: {
    all: ['staff'] as const,
    availabilityToday: ['staff', 'availability-today'] as const,
  },
  staffSchedule: {
    all: ['staff-schedule'] as const,
    range: (weekStart: string, end: string) =>
      ['staff-schedule', 'range', weekStart, end] as const,
    week: (weekStart: string) => ['staff-schedule', 'week', weekStart] as const,
  },
  staffAvailabilityRules: ['staff-availability-rules'] as const,
  repairs: {
    all: ['repairs'] as const,
    list: (page: number, limit: number) => ['repairs', page, limit] as const,
  },
  skuCatalog: {
    /** Broad invalidation prefix — matches every SKU catalog admin query. */
    all: ['sku-catalog'] as const,
    list: (search: string, sort: string, dir: string, page: number) =>
      ['sku-catalog', 'list', search, sort, dir, page] as const,
    detail: (id: number) => ['sku-catalog', 'detail', id] as const,
  },
  boseModels: {
    /** Broad invalidation prefix — matches every Bose model query. */
    all: ['bose-models'] as const,
    list: (search: string, family: string) =>
      ['bose-models', 'list', search, family] as const,
    detail: (id: number) => ['bose-models', 'detail', id] as const,
    lookup: (key: string) => ['bose-models', 'lookup', key] as const,
  },
  /** Brand-neutral product-model façade (Sourcing Hub §5) — Scout lookup. */
  productModels: {
    all: ['product-models'] as const,
    lookup: (key: string) => ['product-models', 'lookup', key] as const,
  },
  partCompatibility: {
    /** Broad invalidation prefix — matches every compatibility-edge query. */
    all: ['part-compatibility'] as const,
    forModel: (boseModelId: number) =>
      ['part-compatibility', 'model', boseModelId] as const,
    forSku: (skuId: number) => ['part-compatibility', 'sku', skuId] as const,
  },
  suppliers: {
    /** Broad invalidation prefix — matches every supplier query. */
    all: ['suppliers'] as const,
    list: (search: string, type: string) => ['suppliers', 'list', search, type] as const,
    detail: (id: number) => ['suppliers', 'detail', id] as const,
  },
  sourcing: {
    /** Broad invalidation prefix — matches every sourcing query. */
    all: ['sourcing'] as const,
    alerts: (status: string) => ['sourcing', 'alerts', status] as const,
    candidates: (skuId: number) => ['sourcing', 'candidates', skuId] as const,
    search: (q: string) => ['sourcing', 'search', q] as const,
    savedSearches: (scope: string) => ['sourcing', 'saved-searches', scope] as const,
    analytics: (range: string) => ['sourcing', 'analytics', range] as const,
  },
  repairIssues: {
    /** Broad invalidation prefix — matches every repair-issue-templates query. */
    all: ['repair-issues'] as const,
    list: () => ['repair-issues', 'list', 'global'] as const,
  },
  favorites: {
    /** Broad invalidation prefix — matches every favorites query. */
    all: ['favorites'] as const,
    list: (workspace: string) => ['favorites', 'list', workspace] as const,
  },
  locationsAdmin: {
    /** Broad invalidation prefix — matches every bins-admin query. */
    all: ['locations-admin'] as const,
    bins: () => ['locations-admin', 'bins'] as const,
  },
  triage: {
    /** Broad invalidation prefix — matches every PO-triage detail query. */
    all: ['triage'] as const,
    /** One unfound-queue email_po row's detail envelope (body + Zoho compare). */
    detail: (sourceId: string) => ['triage', 'detail', sourceId] as const,
  },
  staffAccess: {
    /** Broad invalidation prefix — matches the list and every staff detail. */
    all: ['staff-access'] as const,
    /** The sidebar roster (admin?section=access). */
    list: ['staff-access', 'list'] as const,
    /** One staffer's detail envelope (identity, roles, perms, creds, audit). */
    detail: (staffId: number) => ['staff-access', 'detail', staffId] as const,
    /** One staffer's station assignment (header goal chip). */
    stations: (staffId: number) => ['staff-access', 'stations', staffId] as const,
  },
} as const;
