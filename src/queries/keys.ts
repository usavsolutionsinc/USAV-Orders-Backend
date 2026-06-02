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
} as const;
