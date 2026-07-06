/**
 * operations-history-flags — client-safe rollout flag for the Operations
 * History browse region (docs/operations-history-consolidation-plan.md, Phase 0).
 *
 * Lives OUTSIDE `src/lib/feature-flags.ts` on purpose, mirroring
 * `src/lib/search/unified-header-search.ts`: feature-flags.ts imports the DB
 * pool (`@/lib/db`) and is server-only, but the History view is a client
 * component. `NEXT_PUBLIC_*` is inlined into the client bundle at build time,
 * so a direct static `process.env.NEXT_PUBLIC_…` read resolves in the browser.
 *
 * Default OFF: when off, `/operations?mode=history` renders byte-identical to
 * today — the empty dashed record-lookup prompt — so the browse feed is opt-in.
 * Flip `NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE=true` to land the org-wide
 * filterable browse region (Phase 2) in place of the empty state.
 *
 * Scope note: this flag gates the History UI's Browse region only. The browse
 * backend branch (`GET /api/operations/journey` → `mode:'browse'`, Phase 1) is
 * additive and unguarded — nothing calls it until this flag turns the region
 * on. Independent of `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH`, which gates the
 * separate `?q=` Search-hits region.
 */
export function isOperationsHistoryBrowseEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}
