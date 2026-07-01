/**
 * Intake-kind fork for `TriagePanel` (docs/receiving-triage-redesign-plan.md
 * §3.3) — PO vs Return template selection.
 *
 * `columnsToClassification` (src/lib/receiving/intake-classification.ts) is the
 * canonical PO/Return/Trade-in/Pickup resolver, but it reads `is_return` /
 * `return_platform`, which live on `ReceivingPackageMeta` (a separate fetch),
 * not on the `ReceivingLineRow` the workspace already has in hand. This reads
 * the return signal ReceivingLineRow DOES carry — the per-line
 * `receiving_lines.intake_type` (set by the classification picker on an
 * unmatched line) and the carton-level default — so the template fork needs no
 * extra fetch.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { effectiveIntakeKind } from '@/lib/receiving/kinds/registry';

/**
 * Composes off the effectiveIntakeKind SoT (line override wins unless it's
 * the 'PO' default, else the carton default) rather than an independent
 * "line is RETURN OR carton is RETURN" check — the latter would fork a line
 * explicitly tagged TRADE_IN/PICKUP on a RETURN-default carton into the
 * Return template, contradicting the documented override precedence.
 *
 * Typed to the 3 fields it actually reads (not the full ReceivingLineRow) so
 * a caller holding only a slice of the row — e.g. a Pick<> for a narrower
 * surface — can call it without widening to the full row shape.
 */
export function isReturnIntake(
  row: Pick<ReceivingLineRow, 'intake_type' | 'receiving_type' | 'carton_intake_type'>,
): boolean {
  return effectiveIntakeKind(row.intake_type || row.receiving_type, row.carton_intake_type) === 'RETURN';
}
