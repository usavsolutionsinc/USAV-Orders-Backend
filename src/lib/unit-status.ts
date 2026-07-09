/**
 * Canonical unit-status → Tailwind color classes.
 *
 * This is the single source of truth for how a unit/serial lifecycle status
 * (RECEIVED, TESTED, STOCKED, SHIPPED, …) is colored across the app. It was
 * first centralized for the inventory views; the labels views (unit history,
 * recently-printed) now align to it too so the same status reads the same
 * color everywhere.
 *
 * Two render variants are exposed:
 *   - `badge` — background + text only.
 *   - `chip`  — background + text + ring color (pair with `ring-1 ring-inset`).
 */

interface UnitStatusTone {
    /** bg + text only. */
    badge: string;
    /** bg + text + ring color (used with `ring-1 ring-inset` at the call site). */
    chip: string;
}

const STATUS_TONES: Record<string, UnitStatusTone> = {
    UNKNOWN: { badge: 'bg-surface-sunken text-text-muted', chip: 'bg-surface-sunken text-text-muted ring-border-soft' },
    RECEIVED: { badge: 'bg-blue-50 text-blue-700', chip: 'bg-blue-50 text-blue-700 ring-blue-200' },
    TRIAGED: { badge: 'bg-blue-50 text-blue-700', chip: 'bg-blue-50 text-blue-700 ring-blue-200' },
    IN_TEST: { badge: 'bg-indigo-50 text-indigo-700', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
    IN_REPAIR: { badge: 'bg-amber-50 text-amber-700', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
    REPAIR_DONE: { badge: 'bg-amber-50 text-amber-700', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
    TESTED: { badge: 'bg-emerald-50 text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    GRADED: { badge: 'bg-emerald-50 text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    STOCKED: { badge: 'bg-green-50 text-green-700', chip: 'bg-green-50 text-green-700 ring-green-200' },
    ALLOCATED: { badge: 'bg-purple-50 text-purple-700', chip: 'bg-purple-50 text-purple-700 ring-purple-200' },
    PICKED: { badge: 'bg-purple-50 text-purple-700', chip: 'bg-purple-50 text-purple-700 ring-purple-200' },
    PACKED: { badge: 'bg-purple-50 text-purple-700', chip: 'bg-purple-50 text-purple-700 ring-purple-200' },
    LABELED: { badge: 'bg-purple-50 text-purple-700', chip: 'bg-purple-50 text-purple-700 ring-purple-200' },
    STAGED: { badge: 'bg-purple-50 text-purple-700', chip: 'bg-purple-50 text-purple-700 ring-purple-200' },
    SHIPPED: { badge: 'bg-surface-sunken text-text-muted', chip: 'bg-surface-sunken text-text-muted ring-border-soft' },
    RETURNED: { badge: 'bg-orange-50 text-orange-700', chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
    RMA: { badge: 'bg-orange-50 text-orange-700', chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
    ON_HOLD: { badge: 'bg-red-50 text-red-700', chip: 'bg-red-50 text-red-700 ring-red-200' },
    SCRAPPED: { badge: 'bg-red-100 text-red-700', chip: 'bg-red-100 text-red-700 ring-red-300' },
};

const BADGE_FALLBACK = 'bg-surface-sunken text-text-muted';
const CHIP_FALLBACK = 'bg-surface-sunken text-text-muted ring-border-soft';

/** Plain badge classes (bg + text). Unknown/empty → neutral gray. */
export function unitStatusBadgeClass(status: string | null | undefined): string {
    if (!status) return BADGE_FALLBACK;
    return STATUS_TONES[status]?.badge ?? BADGE_FALLBACK;
}

/** Ring-styled chip classes (bg + text + ring color). Pair with `ring-1 ring-inset`. */
export function unitStatusChipClass(status: string | null | undefined): string {
    if (!status) return CHIP_FALLBACK;
    return STATUS_TONES[status]?.chip ?? CHIP_FALLBACK;
}
