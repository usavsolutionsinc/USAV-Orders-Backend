// Single source of truth for repair-action TYPE tones.
//
// Background + border only (no text color). Single surface today
// (components/repair/mobile/RepairActionTimeline). Classes preserved verbatim;
// hues: replaced=info, repaired/tested=success, cleaned=sky, no_fix=danger,
// awaiting_part=warning. src/lib is in Tailwind's content globs.

export type RepairActionType =
  | 'replaced'
  | 'repaired'
  | 'cleaned'
  | 'tested'
  | 'no_fix'
  | 'awaiting_part';

const TONES: Record<RepairActionType, string> = {
  replaced: 'bg-blue-50 border-blue-200',
  repaired: 'bg-emerald-50 border-emerald-200',
  cleaned: 'bg-sky-50 border-sky-200',
  tested: 'bg-emerald-50 border-emerald-200',
  no_fix: 'bg-rose-50 border-rose-200',
  awaiting_part: 'bg-amber-50 border-amber-200',
};

const FALLBACK = 'bg-white border-slate-200';

/** Background+border classes for a repair-action type; safe for unknowns. */
export function repairActionTypeToneClass(type: string): string {
  return TONES[type as RepairActionType] ?? FALLBACK;
}
