'use client';

import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import { INVENTORY_BUCKETS, type AnyInventoryBucket, type InventoryTab } from '@/lib/inventory-search';

export interface InventoryBucketFilterChipsProps {
    tab: InventoryTab;
    value: AnyInventoryBucket[];
    onChange: (next: AnyInventoryBucket[]) => void;
    /** Counts per bucket id, surfaced as a `(n)` tail when available. */
    counts?: Partial<Record<string, number>>;
}

export function InventoryBucketFilterChips({
    tab,
    value,
    onChange,
    counts,
}: InventoryBucketFilterChipsProps) {
    const buckets = INVENTORY_BUCKETS[tab];
    const selectedSet = new Set<string>(value);

    const toggle = (id: string) => {
        const next = selectedSet.has(id)
            ? value.filter((v) => v !== id)
            : [...value, id as AnyInventoryBucket];
        onChange(next);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className={sectionLabel}>Filters</p>
                {value.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        className={`${microBadge} text-blue-600 hover:underline`}
                    >
                        Clear
                    </button>
                ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {buckets.map((b) => {
                    const active = selectedSet.has(b.id);
                    const count = counts?.[b.id];
                    return (
                        <button
                            key={b.id}
                            type="button"
                            onClick={() => toggle(b.id)}
                            className={[
                                'rounded-full border px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-wide transition-colors',
                                active
                                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-600',
                            ].join(' ')}
                            aria-pressed={active}
                        >
                            <span>{b.label}</span>
                            {typeof count === 'number' ? (
                                <span className="ml-1 text-gray-400">({count})</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
