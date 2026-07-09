/**
 * putaway-placement — the declarative policy that expresses receiving's default
 * putaway routing as a decision table (UNIFIED-ENGINE-MASTER-PLAN §1.6 Track 1,
 * Stage 1.x — the receiving default-putaway strangle site).
 *
 * Today mark-received hardcodes: a `disposition='ACCEPT'` receive with no
 * operator-scanned bin falls back to the org's default putaway bin (the
 * `receiving.defaultPutawayBin` setting / RECEIVING_DEFAULT_PUTAWAY_BIN_BARCODE
 * env, default 'UNSORTED'), resolved through a RESERVE + active bin lookup. This
 * module re-expresses that as a system-default `DecisionRule[]` so the same
 * decision becomes editable in a `/studio` decision node (org rules override it;
 * see resolveSitePlacementBin). It is pure (no DB) — the RESERVE+active bin
 * lookup is supplied as `binDeps` by the call site, keeping this unit-testable.
 */

import type { DecisionRule } from '@/lib/workflow/decision-eval';

/** The filing category the receiving default-putaway rule files units under. */
export const RECEIVING_PUTAWAY_CATEGORY = 'default-putaway';

/**
 * The system-default receiving placement policy: an ACCEPT receive routes to the
 * org's configured default putaway bin. `defaultBinSymbol` is the org-resolved
 * barcode (settings → env), so this targets the exact same bin the legacy path
 * does. An empty symbol yields an empty policy (the caller then degrades to its
 * legacy resolver), never a rule that routes nowhere.
 */
export function receivingDefaultPutawayPolicy(defaultBinSymbol: string): DecisionRule[] {
  const symbol = defaultBinSymbol.trim();
  if (!symbol) return [];
  return [
    {
      id: 'receiving-default-putaway',
      when: { disposition: 'ACCEPT' },
      thenPort: 'putaway',
      then: { placement: symbol, category: RECEIVING_PUTAWAY_CATEGORY },
    },
  ];
}
