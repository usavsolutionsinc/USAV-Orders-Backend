/**
 * Selection scope for the dashboard order tables' pencil "Select → pick rows →
 * act" flow. The Unshipped and Shipped tables are mutually exclusive (only one
 * mounts per `?view`), so they share one scope; the page's delete action
 * branches on the active view, not the scope.
 *
 * Shared by the table side (useTableSelectMode) and the page side
 * (useTableSelection + ContextualSelectionBar) so the string can't drift.
 */
export const DASHBOARD_ORDERS_SELECTION_SCOPE = 'dashboard-orders' as const;
