// Single source of truth for handling-unit (H-####) box status tones.
//
// Flat chip (the only surface — mobile m/h/[id]). Mirrors the
// lib/<domain>-status.ts pattern. Classes preserved verbatim; hues follow the
// color story (DESIGN_SYSTEM.md): OPEN=neutral, STAGED=warning, IN_TEST=info,
// CLOSED=success. src/lib is in Tailwind's content globs.

export type HandlingUnitStatus = 'OPEN' | 'STAGED' | 'IN_TEST' | 'CLOSED';

const TONES: Record<HandlingUnitStatus, string> = {
  OPEN: 'bg-slate-100 text-slate-700',
  STAGED: 'bg-amber-100 text-amber-800',
  IN_TEST: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-emerald-100 text-emerald-700',
};

const FALLBACK = 'bg-slate-100 text-slate-700';

/** Flat chip classes for a handling-unit box status; safe for unknown values. */
export function handlingUnitStatusChipClass(status: string): string {
  return TONES[status as HandlingUnitStatus] ?? FALLBACK;
}
