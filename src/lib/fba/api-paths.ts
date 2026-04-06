/**
 * Centralized FBA API path builders.
 *
 * All client-side fetch() calls for FBA should use these helpers
 * so that a future route rename (shipments → plans) is a one-line change.
 */

const BASE = '/api/fba/shipments';

export const fbaPaths = {
  /** GET: list plans; POST: create plan */
  plans: () => BASE,
  /** GET/PATCH/DELETE a single plan */
  plan: (planId: number | string) => `${BASE}/${planId}`,
  /** GET/POST items for a plan */
  planItems: (planId: number | string) => `${BASE}/${planId}/items`,
  /** GET/PATCH/DELETE a single item */
  planItem: (planId: number | string, itemId: number | string) =>
    `${BASE}/${planId}/items/${itemId}`,
  /** PATCH reassign an item to a different plan */
  planItemReassign: (planId: number | string, itemId: number | string) =>
    `${BASE}/${planId}/items/${itemId}/reassign`,
  /** GET/POST/PATCH/DELETE tracking for a plan */
  planTracking: (planId: number | string) => `${BASE}/${planId}/tracking`,
  /** POST: split lines to a new plan when FBA ID changes from active-shipment prefilled value */
  splitForPairedReview: () => `${BASE}/split-for-paired-review`,
  /** GET today's plan */
  today: () => `${BASE}/today`,
  /** POST add items to today's plan */
  todayItems: () => `${BASE}/today/items`,
  /** POST duplicate yesterday's plan */
  todayDuplicate: () => `${BASE}/today/duplicate-yesterday`,
  /** POST mark items as shipped */
  markShipped: () => `${BASE}/mark-shipped`,
  /** POST close a shipment */
  close: () => `${BASE}/close`,
  /** GET all active + recently shipped shipments with nested items + tracking */
  activeWithDetails: () => `${BASE}/active-with-details`,
} as const;
