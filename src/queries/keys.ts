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
} as const;
