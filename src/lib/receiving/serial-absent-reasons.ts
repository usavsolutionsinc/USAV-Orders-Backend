/**
 * Built-in display registry + bootstrap fallback for the `serial_absent_reason`
 * Class-D vocabulary — *why* a received unit was committed with no serial number.
 *
 * The per-org source of truth is `reason_codes` (flow_context =
 * 'serial_absent_reason'); see the seed migration + `seedOrgCatalog`. This module
 * carries the display metadata (labels + operator hints) and is the fallback the
 * picker renders until that vocabulary is seeded — exactly the merge pattern used
 * by `mergeSubstitutionReasons` (src/lib/fulfillment/substitution-reasons.ts).
 */

export const SERIAL_ABSENT_REASON_FLOW = 'serial_absent_reason' as const;

/**
 * `routine` = an expected, non-alarming reason a unit class simply has no serial
 * (cables, bulk). `anomaly` = a serial *should* exist but is unusable, which is
 * worth flagging. The picker derives its tone from this so color carries meaning:
 * routine reads calm/neutral, anomaly reads as a caution.
 */
export type SerialAbsentSeverity = 'routine' | 'anomaly';

export interface SerialAbsentReasonMeta {
  code: string;
  label: string;
  /** One-line operator explanation surfaced in a HoverTooltip. */
  hint: string;
  severity: SerialAbsentSeverity;
}

export const SERIAL_ABSENT_REASONS: readonly SerialAbsentReasonMeta[] = [
  {
    code: 'NOT_SERIALIZED',
    label: 'Not serialized',
    hint: 'This product class has no serial number — cables, accessories, bulk parts.',
    severity: 'routine',
  },
  {
    code: 'UNREADABLE',
    label: 'Unreadable',
    hint: 'A serial exists but is damaged, rubbed off, or will not scan.',
    severity: 'anomaly',
  },
  {
    code: 'MISSING_LABEL',
    label: 'Missing label',
    hint: 'The serial label is missing from the unit and its packaging.',
    severity: 'anomaly',
  },
  {
    code: 'BULK',
    label: 'Bulk',
    hint: 'Received in bulk quantity; units are not tracked individually.',
    severity: 'routine',
  },
] as const;

const BY_CODE = new Map(SERIAL_ABSENT_REASONS.map((r) => [r.code, r] as const));

function prettifyCode(code: string): string {
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Display label for a code, falling back to a prettified form for custom org codes. */
export function serialAbsentReasonLabel(code: string | null | undefined): string {
  if (!code) return '';
  return BY_CODE.get(code)?.label ?? prettifyCode(code);
}

/** Operator hint for a code (built-ins only; custom org codes have none). */
export function serialAbsentReasonHint(code: string | null | undefined): string | undefined {
  return code ? BY_CODE.get(code)?.hint : undefined;
}

/**
 * Merge DB reason rows (the per-org SoT, when seeded) with the built-in registry
 * for display. DB rows win on label + order; built-ins supply hints and act as
 * the fallback list when the vocabulary is unseeded or the fetch failed.
 */
export function mergeSerialAbsentReasons(
  dbRows: ReadonlyArray<{ code: string; label: string }> | null | undefined,
): SerialAbsentReasonMeta[] {
  if (!dbRows || dbRows.length === 0) return [...SERIAL_ABSENT_REASONS];
  return dbRows.map((row) => {
    const builtin = BY_CODE.get(row.code);
    return {
      code: row.code,
      label: (row.label || builtin?.label || prettifyCode(row.code)).trim(),
      hint: builtin?.hint ?? '',
      // Custom org codes we can't classify default to the calm 'routine' tone so
      // an unknown reason never cries wolf; built-ins keep their declared severity.
      severity: builtin?.severity ?? 'routine',
    };
  });
}

/** Server-side guard: a waiver reason must be a non-empty code string. */
export function isValidSerialAbsentReason(code: string | null | undefined): code is string {
  return typeof code === 'string' && code.trim().length > 0;
}
