/**
 * unified-header-search — client-safe rollout flag for the unified global
 * header search (docs/unified-global-search-consolidation-plan.md, decision D7).
 *
 * Lives OUTSIDE `src/lib/feature-flags.ts` on purpose: that module imports the
 * DB pool (`@/lib/db`) and is server-only, but the header is a client
 * component. `NEXT_PUBLIC_*` is inlined into the client bundle at build time,
 * so this reads correctly in the browser.
 *
 * Default ON as of 2026-07-06 (Phases A–E built out per
 * docs/global-header-search-best-in-class-plan.md): the unified header search
 * — recents dropdown, rich preview rows, and the operations browse→drill
 * surface — is the shipped experience. An explicit kill switch remains for a
 * fast rollback without a code change: set
 * `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH=false` (or `0` / `off` / `no`) to restore
 * the pre-unification header + paste-a-number operations lookup. Any other
 * value (or unset) keeps it ON.
 */
export function isUnifiedHeaderSearchEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_UNIFIED_HEADER_SEARCH;
  if (!raw) return true; // default ON — flipped 2026-07-06
  const v = raw.trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
}
