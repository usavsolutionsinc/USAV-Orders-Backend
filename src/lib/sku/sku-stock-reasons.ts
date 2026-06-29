/**
 * SKU-stock manual-adjust reason vocabulary — the quick reasons on the
 * SkuStockCard +/- adjust. BEHAVIOR-BEARING: the code string is written to
 * sku_stock_ledger.reason, and the replenish trigger (2026-06-06j_sku_replenish.sql)
 * fires on reason='SOLD'. So the CODES stay system (must match the trigger);
 * seeded into reason_codes (flow_context='inventory_adjust') only so a tenant can
 * RELABEL them. This is the single registry + the offline fallback. See
 * docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md §3.D.
 *
 * DEFERRED (a UX refactor, not safe to do blindly on the live replenish path):
 * these quick reasons overlap the granular inventory_event reason_codes (the
 * bin-numpad ReasonCodePicker vocabulary). Reconciling them into ONE direction-
 * aware vocabulary AND keying the replenish trigger on category='sale' (not the
 * 'SOLD' string) is the proper end state — see the plan's D2 note.
 */

interface SkuStockReason {
  code: string;
  label: string;
}

export const SKU_STOCK_REASONS: readonly SkuStockReason[] = [
  { code: 'RECEIVED', label: 'Received' },
  { code: 'SOLD', label: 'Sold' },
  { code: 'DAMAGED', label: 'Damaged' },
  { code: 'ADJUSTMENT', label: 'Adjustment' },
  { code: 'RETURNED', label: 'Returned' },
  { code: 'CYCLE_COUNT', label: 'Cycle count' },
];
