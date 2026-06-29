/**
 * Repair-failure reason vocabulary — the GLOBAL built-in SoT for repair intake
 * reasons. Repair already has a per-SKU DB-backed source (`repair_issue_templates`
 * → the `skuIssues` prop); this registry is the generic fallback used when a SKU
 * has no template. Seeded into reason_codes (flow_context='repair_failure') so a
 * tenant can manage the generic set, and the offline fallback when the DB is
 * unseeded / unreachable. Descriptive — repair reasons are concatenated into the
 * `repair_service.issue` text; nothing branches on a specific value.
 * See docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md D1.
 *
 * The repair flow stores the LABEL (free text), so the label is the meaningful
 * unit; `code` is the stable slug used as the reason_codes natural key.
 */

interface RepairFailureReason {
  code: string;
  label: string;
}

export const REPAIR_FAILURE_REASONS: readonly RepairFailureReason[] = [
  { code: 'PLEASE_WAIT', label: 'Please wait' },
  { code: 'SKIP', label: 'Skip' },
  { code: 'NO_SOUND', label: 'No sound' },
  { code: 'SPEAKER_BUZZ', label: 'Speaker Buzz' },
  { code: 'CD_ISSUES', label: 'CD Issues' },
  { code: 'LCD_ISSUES', label: 'LCD Issues' },
];

/** The label list — what ReasonSelector renders/stores when there's no per-SKU template. */
export const REPAIR_FAILURE_LABELS: readonly string[] = REPAIR_FAILURE_REASONS.map((r) => r.label);
