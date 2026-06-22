// Single source of truth for mobile PO-detail header status tones.
//
// Flat chip (the only surface — mobile m/receiving/po/[poId]). Mirrors the
// lib/<domain>-status.ts pattern. Classes preserved verbatim; hues follow the
// color story (DESIGN_SYSTEM.md): OPEN=warning, RECEIVED=success.
// src/lib is in Tailwind's content globs.

export type PoHeaderStatus = 'OPEN' | 'RECEIVED';

const TONES: Record<PoHeaderStatus, string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
};

const FALLBACK = 'bg-slate-100 text-slate-600';

/** Flat chip classes for a PO header status; safe for unknown values. */
export function poHeaderStatusChipClass(status: string): string {
  return TONES[status as PoHeaderStatus] ?? FALLBACK;
}
