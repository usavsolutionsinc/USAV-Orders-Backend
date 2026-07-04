// Single source of truth for warehouse replenishment-task status tones.
//
// Bordered pill (the only surface — app/warehouse/replenishment). Mirrors the
// lib/<domain>-status.ts pattern (see unit-status.ts, repair-status.ts).
// Classes preserved verbatim from the original inline map; hues follow the
// color story (DESIGN_SYSTEM.md): REQUESTED=warning, IN_PROGRESS=info,
// COMPLETE=success, CANCELED=neutral. src/lib is in Tailwind's content globs.

export type ReplenishmentStatus = 'REQUESTED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELED';

const TONES: Record<ReplenishmentStatus, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800 border-amber-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-800 border-blue-200',
  COMPLETE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  CANCELED: 'bg-surface-sunken text-text-muted border-border-soft',
};

const FALLBACK = 'bg-surface-sunken text-text-muted border-border-soft';

/** Bordered pill classes for a replenishment task status; safe for unknowns. */
export function replenishmentStatusBadgeClass(status: string): string {
  return TONES[status as ReplenishmentStatus] ?? FALLBACK;
}
