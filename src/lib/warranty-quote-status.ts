// Single source of truth for warranty repair-QUOTE status tones.
//
// Distinct from warranty CLAIM status (see lib/warranty/types.ts). Flat chip.
// Single surface today (components/warranty/WarrantyQuotesSection). Classes
// preserved verbatim; hues follow the color story (DESIGN_SYSTEM.md):
// DRAFT=neutral, SENT=info, ACCEPTED=success, DECLINED=danger, EXPIRED=neutral.
// src/lib is in Tailwind's content globs.

export type WarrantyQuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

const TONES: Record<WarrantyQuoteStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SENT: 'bg-blue-100 text-blue-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  DECLINED: 'bg-rose-100 text-rose-700',
  EXPIRED: 'bg-zinc-200 text-zinc-700',
};

/** Flat chip classes for a warranty quote status; falls back to `DRAFT`. */
export function warrantyQuoteToneClass(status: string): string {
  return TONES[status as WarrantyQuoteStatus] ?? TONES.DRAFT;
}
