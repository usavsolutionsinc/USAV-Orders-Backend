// Single source of truth for RMA (return authorization) status tones.
//
// Bordered pill (the only surface — app/warehouse/rma). Mirrors the
// lib/<domain>-status.ts pattern. Classes preserved verbatim from the original
// inline map; hues follow the color story (DESIGN_SYSTEM.md): AUTHORIZED=warning,
// RECEIVED=info, DISPOSITIONED=fulfillment(purple), CLOSED=success,
// EXPIRED/CANCELED=neutral. src/lib is in Tailwind's content globs.

export type RmaStatus =
  | 'AUTHORIZED'
  | 'RECEIVED'
  | 'DISPOSITIONED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELED';

const TONES: Record<RmaStatus, string> = {
  AUTHORIZED: 'bg-amber-100 text-amber-800 border-amber-200',
  RECEIVED: 'bg-blue-100 text-blue-800 border-blue-200',
  DISPOSITIONED: 'bg-purple-100 text-purple-800 border-purple-200',
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EXPIRED: 'bg-surface-strong text-text-muted border-border-default',
  CANCELED: 'bg-surface-sunken text-text-muted border-border-soft',
};

const FALLBACK = 'bg-surface-sunken text-text-muted border-border-soft';

/** Bordered pill classes for an RMA status; safe for unknown values. */
export function rmaStatusBadgeClass(status: string): string {
  return TONES[status as RmaStatus] ?? FALLBACK;
}
