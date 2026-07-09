/**
 * TriageFocusResolver — pure "where should attention go after a triage scan
 * resolves" function (docs/receiving-triage-redesign-plan.md §3.7).
 *
 * Pure + DB-free, mirroring the other triage lib modules (intake-classification,
 * triage-lane-policy): a scan-resolve handler calls this with the resolved
 * carton's facts and gets back one focus target, which it then acts on (scroll
 * to a section, open a tab, show a toast). The mapping itself never changes
 * based on which UI happens to exist yet — `stage` is a real, meaningful target
 * even before Phase 2's shelf/lane picker ships; a caller with no Stage UI to
 * focus simply no-ops on that target today.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { isReturnIntake } from './triage-intake-kind';

export type TriageFocusTarget =
  | 'classify'
  | 'stage'
  | 'pair'
  | 'already-staged'
  | 'none';

export interface TriageFocusFacts {
  /** True once `receiving_lines.intake_type` (or the matched PO) resolves the kind. */
  isClassified: boolean;
  isReturn: boolean;
  /** `receiving.staging_location_id` set. */
  isStaged: boolean;
  /** `receiving.pairing_state !== 'UNFOUND'`, or the carton has a real PO link / claim. */
  isPaired: boolean;
  /** `receiving.triage_complete`. */
  isTriageComplete: boolean;
}

/**
 * Resolve the next focus target for a just-resolved triage scan. Order matters:
 * a completed carton always short-circuits to `already-staged` regardless of
 * its other facts (nothing left to do); otherwise the first unmet step in the
 * Scan→Classify→Stage→Pair order wins.
 */
export function resolveTriageFocus(facts: TriageFocusFacts): TriageFocusTarget {
  if (facts.isTriageComplete) return 'already-staged';
  if (!facts.isClassified) return 'classify';
  if (!facts.isStaged) return 'stage';
  if (!facts.isPaired) return 'pair';
  return 'none';
}

/**
 * Stable DOM anchor ids for the three focusable `TriagePanel` sections —
 * `TriagePanel`'s auto-focus effect calls `document.getElementById` + smooth
 * `scrollIntoView` rather than threading refs through the PO/Return template
 * split. Both templates stamp these onto their section wrappers.
 */
export const TRIAGE_SECTION_ID: Record<'classify' | 'stage' | 'pair', string> = {
  classify: 'triage-section-classify',
  stage: 'triage-section-stage',
  pair: 'triage-section-pair',
};

// ── ReceivingLineRow → TriageFocusFacts ─────────────────────────────────────
// The single source for each per-step predicate — `TriageProgressStepper` and
// `TriagePanel`'s live focus-resolve effect both read these, so the stepper's
// dot state and the auto-focus target can never disagree about what "done"
// means for a given step.

/** Carton has an explicit classification (via `receiving_lines.intake_type`) or is already Zoho-matched. */
export function isTriageClassified(row: ReceivingLineRow): boolean {
  if (row.receiving_source !== 'unmatched') return true;
  return !!(row.intake_type && row.intake_type.trim());
}

/** A1 — both a physical shelf AND a priority lane are required to count as staged. */
export function isTriageStaged(row: ReceivingLineRow): boolean {
  return row.staging_location_id != null && !!row.priority_lane;
}

/** PO matched, pairing acknowledged/waived, a claim is linked, or a return with no label hint (C6). */
export function isTriagePaired(row: ReceivingLineRow): boolean {
  if (row.receiving_source !== 'unmatched') return true;
  if (row.pairing_state === 'WAIVED' || row.pairing_state === 'MATCHED') return true;
  if (row.zendesk_ticket) return true;
  return isReturnIntake(row);
}

/** Compose a `ReceivingLineRow` into the facts `resolveTriageFocus` reads. */
export function deriveTriageFocusFacts(
  row: ReceivingLineRow,
  isTriageComplete: boolean,
): TriageFocusFacts {
  return {
    isClassified: isTriageClassified(row),
    isReturn: isReturnIntake(row),
    isStaged: isTriageStaged(row),
    isPaired: isTriagePaired(row),
    isTriageComplete,
  };
}
