// Single source of truth for tracking-exception (inventory triage) status tones.
//
// Mirrors the lib/<domain>-status.ts pattern (see unit-status.ts,
// outbound-state.ts): one tone map + resolver fns, two render variants —
// `badge` (no ring, used in workspace headers) and `chip` (ring, used in
// sidebar rows). Replaces the two divergent inline STATUS_TONE maps that
// previously lived in TriageWorkspace.tsx and InventoryTriageSidebar.tsx.
//
// Hue meanings follow the documented color story (DESIGN_SYSTEM.md →
// Functional Color Mapping): open = caution, resolved = success,
// discarded = neutral. Classes are preserved verbatim from the originals so
// this consolidation is visually identical; a later pass may snap them to the
// semantic `*-warning`/`*-success` aliases. src/lib is in Tailwind's content
// globs, so these classes are generated.

export type TriageExceptionStatus = 'open' | 'resolved' | 'discarded';

interface TriageStatusTone {
  label: string;
  /** Badge variant — no ring (workspace header pill). */
  badge: string;
  /** Chip variant — with ring (sidebar row pill). */
  chip: string;
}

const TRIAGE_STATUS_TONES: Record<TriageExceptionStatus, TriageStatusTone> = {
  open: {
    label: 'Open',
    badge: 'bg-amber-50 text-amber-700',
    chip: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  resolved: {
    label: 'Resolved',
    badge: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  discarded: {
    label: 'Discarded',
    badge: 'bg-gray-100 text-gray-500',
    chip: 'bg-gray-100 text-gray-500 ring-gray-200',
  },
};

const FALLBACK_BADGE = 'bg-gray-100 text-gray-500';
const FALLBACK_CHIP = 'bg-gray-100 text-gray-500 ring-gray-200';

/** Badge classes (no ring) for a triage status; safe for unknown values. */
export function triageStatusBadgeClass(status: string): string {
  return TRIAGE_STATUS_TONES[status as TriageExceptionStatus]?.badge ?? FALLBACK_BADGE;
}

/** Chip classes (with ring) for a triage status; safe for unknown values. */
export function triageStatusChipClass(status: string): string {
  return TRIAGE_STATUS_TONES[status as TriageExceptionStatus]?.chip ?? FALLBACK_CHIP;
}

/** Human label for a triage status; falls back to the raw code. */
export function triageStatusLabel(status: string): string {
  return TRIAGE_STATUS_TONES[status as TriageExceptionStatus]?.label ?? status;
}
