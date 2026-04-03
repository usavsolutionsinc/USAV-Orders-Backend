/**
 * Centralized FBA custom-event name constants.
 *
 * Every `window.dispatchEvent(new CustomEvent('fba-…'))` and matching
 * `window.addEventListener('fba-…')` should reference a constant here
 * so typos become compile errors instead of silent no-ops.
 */

// ── Board selection ─────────────────────────────────────────────────────────
/** FbaBoardTable → sidebar: array of selected FbaBoardItem[] */
export const FBA_BOARD_SELECTION = 'fba-board-selection' as const;
/** FbaBoardTable → sidebar: { selected, total, selectedQty, totalQty } */
export const FBA_BOARD_SELECTION_COUNT = 'fba-board-selection-count' as const;
/** Sidebar → FbaBoardTable: 'all' | 'none' */
export const FBA_BOARD_TOGGLE_ALL = 'fba-board-toggle-all' as const;
/** Sidebar → FbaBoardTable: select all items matching a due_date (YYYY-MM-DD) */
export const FBA_BOARD_SELECT_BY_DAY = 'fba-board-select-by-day' as const;
/** StationFbaInput (select mode) → FbaBoardTable: select items matching an FNSKU */
export const FBA_BOARD_SELECT_BY_FNSKU = 'fba-board-select-by-fnsku' as const;
/** FbaBoardTable → StationFbaInput: result of a select-by-fnsku attempt */
export const FBA_BOARD_FNSKU_SELECT_RESULT = 'fba-board-fnsku-select-result' as const;
/** Sidebar → FbaBoardTable: deselect one item_id */
export const FBA_BOARD_DESELECT_ITEM = 'fba-board-deselect-item' as const;

// ── Paired / review tab ─────────────────────────────────────────────────────
/** FbaPage → sidebar: paired-tab selection changed */
export const FBA_PAIRED_SELECTION = 'fba-paired-selection' as const;

// ── Board injection (select-mode auto-add) ─────────────────────────────────
/** Inject a single FbaBoardItem into the board without a full refresh. */
export const FBA_BOARD_INJECT_ITEM = 'fba-board-inject-item' as const;
/** Remove item IDs from the board after combining/shipping (detail: number[]). */
export const FBA_BOARD_REMOVE_ITEMS = 'fba-board-remove-items' as const;
/** Adjusted selection counts from the paired review panel (qty steppers). */
export const FBA_SELECTION_ADJUSTED = 'fba-selection-adjusted' as const;
/** Active shipment bundle → paired review: prefill FBA ID + UPS and set selection. detail: { items, amazonShipmentId, upsTracking, activeShipmentSplit?: { sourcePlanId, prefilledAmazonShipmentId } } */
export const FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW = 'fba-send-shipment-to-paired-review' as const;
/** Toggle combine / paired review panel expanded vs compact strip. Optional detail.sendToPaired when expanding from strip with active-shipment selection. */
export const FBA_PAIRED_REVIEW_TOGGLE = 'fba-paired-review-toggle' as const;

// ── Plan lifecycle ──────────────────────────────────────────────────────────
/** After a new plan is created (POST /api/fba/shipments) */
export const FBA_PLAN_CREATED = 'fba-plan-created' as const;
/** Focus a plan card in the sidebar */
export const FBA_PRINT_FOCUS_PLAN = 'fba-print-focus-plan' as const;
/** Print queue items changed — reload sidebar plan list */
export const FBA_PRINT_QUEUE_REFRESH = 'fba-print-queue-refresh' as const;
/** Tracking attached → move items to shipped / refresh board */
export const FBA_PRINT_SHIPPED = 'fba-print-shipped' as const;
/** Sidebar tracking readiness map updated */
export const FBA_PRINT_SIDEBAR_READY = 'fba-print-sidebar-ready' as const;

// ── FNSKU catalog ───────────────────────────────────────────────────────────
/** Open the quick-add FNSKU modal */
export const FBA_OPEN_QUICK_ADD_FNSKU = 'fba-open-quick-add-fnsku' as const;
/** FNSKU catalog row saved (from modal) */
export const FBA_FNSKU_SAVED = 'fba-fnsku-saved' as const;

// ── Admin catalog ───────────────────────────────────────────────────────────
export const ADMIN_FBA_OPEN_ADD = 'admin-fba-open-add' as const;
export const ADMIN_FBA_OPEN_UPLOAD = 'admin-fba-open-upload' as const;

// ── Global refresh (shared across FBA + other pages) ────────────────────────
export const USAV_REFRESH_DATA = 'usav-refresh-data' as const;
export const DASHBOARD_REFRESH = 'dashboard-refresh' as const;
