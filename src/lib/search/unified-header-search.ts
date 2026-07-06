/**
 * unified-header-search — client-safe rollout flag for the unified global
 * header search (docs/unified-global-search-consolidation-plan.md, decision D7).
 *
 * Lives OUTSIDE `src/lib/feature-flags.ts` on purpose: that module imports the
 * DB pool (`@/lib/db`) and is server-only, but the header is a client
 * component. `NEXT_PUBLIC_*` is inlined into the client bundle at build time,
 * so this reads correctly in the browser.
 *
 * Default OFF: when off, the header renders byte-identical to today (no recents
 * dropdown, no legacy migration, nothing recorded) so the transition is opt-in.
 * Flip `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH=true` to enable the recents layer.
 */
export function isUnifiedHeaderSearchEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_UNIFIED_HEADER_SEARCH;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}
