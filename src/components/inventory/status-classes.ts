/**
 * Single source of truth for inventory unit status → Tailwind color classes.
 *
 * Previously this map was copy-pasted (and had drifted) across three files:
 *   - InventoryFilterChips.tsx (ring-styled toggle chips)
 *   - EventRow.tsx             (plain badges)
 *   - ByFilterResultList.tsx   (plain badges)
 *
 * Two render variants are exposed so the exact prior styling is preserved:
 *   - `badge` — background + text only.
 *   - `chip`  — background + text + ring (for the filter toggle buttons).
 */

interface StatusTone {
    /** bg + text only. */
    badge: string;
    /** bg + text + ring color (used with `ring-1 ring-inset` at the call site). */
    chip: string;
}

const STATUS_TONES: Record<string, StatusTone> = {
    UNKNOWN: { badge: 'bg-gray-100 text-gray-600', chip: 'bg-gray-100 text-gray-600 ring-gray-200' },
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
    SHIPPED: { badge: 'bg-gray-100 text-gray-700', chip: 'bg-gray-100 text-gray-700 ring-gray-200' },
    RETURNED: { badge: 'bg-orange-50 text-orange-700', chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
    RMA: { badge: 'bg-orange-50 text-orange-700', chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
    ON_HOLD: { badge: 'bg-red-50 text-red-700', chip: 'bg-red-50 text-red-700 ring-red-200' },
    SCRAPPED: { badge: 'bg-red-100 text-red-700', chip: 'bg-red-100 text-red-700 ring-red-300' },
};

const BADGE_FALLBACK = 'bg-gray-100 text-gray-600';
const CHIP_FALLBACK = 'bg-gray-100 text-gray-700 ring-gray-200';

/** Plain badge classes (bg + text). Unknown/empty → neutral gray. */
export function inventoryStatusBadgeClass(status: string | null | undefined): string {
    if (!status) return BADGE_FALLBACK;
    return STATUS_TONES[status]?.badge ?? BADGE_FALLBACK;
}

/** Ring-styled chip classes (bg + text + ring color). Pair with `ring-1 ring-inset`. */
export function inventoryStatusChipClass(status: string | null | undefined): string {
    if (!status) return CHIP_FALLBACK;
    return STATUS_TONES[status]?.chip ?? CHIP_FALLBACK;
}
