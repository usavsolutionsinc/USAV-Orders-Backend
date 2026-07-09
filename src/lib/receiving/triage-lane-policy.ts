/**
 * Triage lane policy — the auto-routing rule table for `receiving.priority_lane`
 * (docs/receiving-triage-redesign-plan.md §4.2, decision D3).
 *
 * Mirrors `src/lib/receiving/putaway-placement.ts`'s `receivingDefaultPutawayPolicy`
 * pattern exactly: a pure, DB-free `DecisionRule[]` table reusing the SAME shared
 * evaluator (`src/lib/workflow/decision-eval.ts`) the `/studio` decision node
 * already runs — so this table is pluggable into a decision node with zero engine
 * changes, the moment an org wants to edit it visually. `DecisionFacts` only
 * carries `grade`/`channel`/`disposition` (shared across every decision-node
 * consumer, incl. the ZEN/WASM parity path in decision-eval-zen.ts) — rather than
 * widen that shared vocabulary for one caller, triage folds its own signal
 * (return vs PO, priority vs standard) into `channel` via {@link triageLaneChannel},
 * the same way a sales channel would be encoded for inspection/putaway rules.
 *
 * The operator's MANUAL lane override always wins over the auto-routed default —
 * same relationship `priority_tier` already has to the auto `is_priority` flag
 * (manual COALESCEs first). See {@link resolveTriageLane}.
 */

import { resolveDecision, type DecisionRule } from '@/lib/workflow/decision-eval';

/** The filing category triage-lane rules are tagged under (mirrors RECEIVING_PUTAWAY_CATEGORY). */
export const TRIAGE_LANE_CATEGORY = 'triage-lane';

/**
 * Lane values — v1 small fixed list (mirrors `RECEIVING_EXCEPTION_CODES`'s
 * precedent). Revisit only if a tenant asks for a custom lane (see the plan's
 * open sub-question under D3).
 */
export const TRIAGE_LANE_OPTS = [
  { value: 'PO_STOCKOUT', label: 'PO — Stock-out' },
  { value: 'PO_STANDARD', label: 'PO — Standard' },
  { value: 'RETURN', label: 'Return' },
  { value: 'HOLD', label: 'Hold / exception' },
] as const;

export type TriageLane = (typeof TRIAGE_LANE_OPTS)[number]['value'];

export function isTriageLane(v: unknown): v is TriageLane {
  return typeof v === 'string' && TRIAGE_LANE_OPTS.some((o) => o.value === v);
}

export function triageLaneLabel(lane: string | null | undefined): string {
  return TRIAGE_LANE_OPTS.find((o) => o.value === lane)?.label ?? 'Unassigned';
}

/** The carton facts the auto-routing rules read (pre-`channel`-encoding). */
export interface TriageLaneFacts {
  isReturn: boolean;
  /** receiving.is_priority — pending-order match or manual priority_tier 0 (see precedence.ts). */
  isPriority: boolean;
}

/**
 * Fold the carton's return/priority facts into the `channel` fact
 * `DecisionRule.when` already supports, so the triage policy needs no change to
 * the shared `DecisionFacts` shape. Kept as its own named function (not inlined)
 * so a `/studio` rule editor can document the exact channel values it may match.
 */
export function triageLaneChannel(facts: TriageLaneFacts): 'return' | 'priority_po' | 'po' {
  if (facts.isReturn) return 'return';
  return facts.isPriority ? 'priority_po' : 'po';
}

/**
 * The system-default lane policy: priority PO → stock-out lane, return → return
 * lane, everything else → standard PO lane. First-match-wins, so an org
 * override in a future `/studio` decision node can insert a rule ahead of these
 * (e.g. route a specific vendor's returns to HOLD) without touching this module.
 */
export function receivingTriageLanePolicy(): DecisionRule[] {
  return [
    {
      id: 'triage-lane-priority-po',
      when: { channel: 'priority_po' },
      thenPort: 'lane',
      then: { placement: 'PO_STOCKOUT', category: TRIAGE_LANE_CATEGORY },
    },
    {
      id: 'triage-lane-return',
      when: { channel: 'return' },
      thenPort: 'lane',
      then: { placement: 'RETURN', category: TRIAGE_LANE_CATEGORY },
    },
    {
      id: 'triage-lane-po-standard',
      when: { channel: 'po' },
      thenPort: 'lane',
      then: { placement: 'PO_STANDARD', category: TRIAGE_LANE_CATEGORY },
    },
  ];
}

/**
 * Resolve the effective lane for a carton: the operator's manual assignment
 * always wins; otherwise the policy table picks a default from the carton's
 * facts. Returns null only when neither a manual value nor a matching rule
 * exists (an empty/misconfigured policy) — callers treat null as "unassigned",
 * never as HOLD.
 */
export function resolveTriageLane(
  manualLane: string | null | undefined,
  facts: TriageLaneFacts,
  rules: DecisionRule[] = receivingTriageLanePolicy(),
): TriageLane | null {
  const manual = (manualLane ?? '').trim().toUpperCase();
  if (isTriageLane(manual)) return manual;

  const outcome = resolveDecision(rules, null, { channel: triageLaneChannel(facts) });
  const placement = outcome.placement?.placement;
  return isTriageLane(placement) ? placement : null;
}
