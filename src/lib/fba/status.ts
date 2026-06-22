/**
 * Canonical FBA shipment/item status vocabulary — the single source of truth.
 *
 * Replaces the three drifting vocabularies that existed before:
 *   - FbaBoardTable STATUS_SORT_ORDER (READY_TO_GO/PACKING/PLANNED/…)
 *   - components/fba/types.ts FbaWorkflowMode (PLAN/PACKING/PRINT_READY/NONE)
 *   - shared/FbaStatusBadge TOKENS (PLANNED/READY_TO_GO/LABEL_ASSIGNED/…)
 *
 * Operator-facing lifecycle (see 2026-05-28_fba_status_rename_tested_packed.sql):
 *
 *   PLANNED → TESTED → PACKED → LABEL_ASSIGNED → SHIPPED
 *
 *   PLANNED        — planning/inventory + staff acknowledge today's FBA items
 *   TESTED         — technician scanned the FNSKU; passed, ready to be packed
 *   PACKED         — packer scanned the FNSKU; ready to combine
 *   LABEL_ASSIGNED — combined under one FBA shipment ID (multi-UPS tracking)
 *   SHIPPED        — UPS tracking scanned; whole package handed to carrier
 *
 * OUT_OF_STOCK and CLOSED are off-the-happy-path side states.
 *
 * This module is framework-agnostic (no React / no JSX) so API routes and
 * components can both import it. Badge rendering lives in
 * components/fba/shared/FbaStatusBadge.tsx, which sources labels + order here.
 */

export const FBA_STATUS = {
  PLANNED: 'PLANNED',
  TESTED: 'TESTED',
  PACKED: 'PACKED',
  LABEL_ASSIGNED: 'LABEL_ASSIGNED',
  SHIPPED: 'SHIPPED',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  CLOSED: 'CLOSED',
} as const;

export type FbaStatus = (typeof FBA_STATUS)[keyof typeof FBA_STATUS];

/** The happy-path lifecycle, in order. Drives steppers and progress UI. */
export const FBA_LIFECYCLE: FbaStatus[] = [
  FBA_STATUS.PLANNED,
  FBA_STATUS.TESTED,
  FBA_STATUS.PACKED,
  FBA_STATUS.LABEL_ASSIGNED,
  FBA_STATUS.SHIPPED,
];

/** Board sort order — lowest sorts first. Side states sit after the path. */
export const FBA_STATUS_ORDER: Record<string, number> = {
  PACKED: 0, // combiner's queue surfaces first
  TESTED: 1,
  PLANNED: 2,
  OUT_OF_STOCK: 3,
  LABEL_ASSIGNED: 4,
  SHIPPED: 5,
  CLOSED: 6,
};

/** Operator-facing display labels. LABEL_ASSIGNED reads as "Combined". */
export const FBA_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planned',
  TESTED: 'Tested',
  PACKED: 'Packed',
  LABEL_ASSIGNED: 'Combined',
  SHIPPED: 'Shipped',
  OUT_OF_STOCK: 'Out of Stock',
  CLOSED: 'Closed',
};

/**
 * Status-pill background+text classes (single source of truth, beside the
 * labels). Consolidates the inline `STATUS_PILL_COLOR` map formerly in
 * FbaBoardTable. SHIPPED/CLOSED intentionally fall back to neutral gray
 * (matching prior behavior). Classes are plain strings so this module stays
 * framework-agnostic; src/lib is in Tailwind's content globs.
 */
export const FBA_STATUS_PILL: Record<string, string> = {
  PLANNED: 'bg-amber-100 text-amber-700',
  TESTED: 'bg-emerald-100 text-emerald-700',
  PACKED: 'bg-blue-100 text-blue-700',
  OUT_OF_STOCK: 'bg-red-100 text-red-700',
  LABEL_ASSIGNED: 'bg-green-100 text-green-700',
};

/** Pill classes for an FBA status (case-insensitive); safe for unknowns. */
export function fbaStatusPillClass(status: string): string {
  return FBA_STATUS_PILL[status.toUpperCase()] ?? 'bg-gray-100 text-gray-600';
}

/** Allowed forward + revert transitions. Used to guard status writes. */
export const FBA_ALLOWED_TRANSITIONS: Record<string, FbaStatus[]> = {
  PLANNED: [FBA_STATUS.TESTED, FBA_STATUS.OUT_OF_STOCK],
  TESTED: [FBA_STATUS.PACKED, FBA_STATUS.OUT_OF_STOCK, FBA_STATUS.PLANNED],
  PACKED: [FBA_STATUS.LABEL_ASSIGNED, FBA_STATUS.TESTED],
  LABEL_ASSIGNED: [FBA_STATUS.SHIPPED, FBA_STATUS.PACKED],
  SHIPPED: [],
  OUT_OF_STOCK: [FBA_STATUS.PLANNED, FBA_STATUS.TESTED],
  CLOSED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (FBA_ALLOWED_TRANSITIONS[from] ?? []).includes(to as FbaStatus);
}

export function isTerminalFbaStatus(status: string): boolean {
  return status === FBA_STATUS.SHIPPED || status === FBA_STATUS.CLOSED;
}

/** Statuses the combiner pulls from on the Combine sub-page. */
export const FBA_COMBINE_QUEUE_STATUSES: FbaStatus[] = [FBA_STATUS.PACKED];
