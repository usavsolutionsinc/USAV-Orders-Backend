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
 * Default ON as of the **Phase 7 cutover** (2026-07-06): the `/audit-log` routes
 * are removed and redirect here, so the History browse feed IS the forensic/audit
 * surface — it can't be opt-in anymore. Set
 * `NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE=false` to force it off (break-glass).
 *
 * ⚠️ ROLLOUT NOTE: flipping this default ON turns on every Phase 2–5 browse
 * behavior (browse feed, sidebar filters, `/receiving/history` redirect). It is a
 * one-line, reversible change — revert to the default-OFF form if you want an
 * env-controlled staged rollout instead. **Live-smoke before deploying.**
 *
 * Scope note: this flag gates the History UI's Browse region only. The browse
 * backend branch (`GET /api/operations/journey` → `mode:'browse'`, Phase 1) is
 * additive. Independent of `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH`, which gates the
 * separate `?q=` Search-hits region.
 */
export function isOperationsHistoryBrowseEnabled(): boolean {
  const v = (process.env.NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE ?? '').trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off' && v !== 'no';
}
