'use client';

import { useEffect, useRef, useState } from 'react';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { SlidersHorizontal, ChevronDown } from '@/components/Icons';
import { INVENTORY_BUCKETS, type AnyInventoryBucket, type InventoryTab } from '@/lib/inventory-search';

export interface InventoryBucketFilterChipsProps {
    tab: InventoryTab;
    value: AnyInventoryBucket[];
    onChange: (next: AnyInventoryBucket[]) => void;
    /** Counts per bucket id, surfaced as a `(n)` tail when available. */
    counts?: Partial<Record<string, number>>;
}

/**
 * Bucket (multi-select) filters as a single popover trigger rather than an
 * always-visible chip row — keeps the sidebar header compact. The trigger
 * shows the active count; the popover holds the toggle chips.
 */
export function InventoryBucketFilterChips({
    tab,
    value,
    onChange,
    counts,
}: InventoryBucketFilterChipsProps) {
    const buckets = INVENTORY_BUCKETS[tab];
    const selectedSet = new Set<string>(value);
    const activeCount = value.length;

    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Close on outside click / Escape.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const toggle = (id: string) => {
        const next = selectedSet.has(id)
            ? value.filter((v) => v !== id)
            : [...value, id as AnyInventoryBucket];
        onChange(next);
    };

    return (
        <div ref={rootRef} className="relative w-full">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="dialog"
                className={[
                    'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors',
                    activeCount > 0
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-600',
                ].join(' ')}
            >
                <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {activeCount > 0 ? (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-eyebrow font-bold text-white">
                            {activeCount}
                        </span>
                    ) : null}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open ? (
                <div
                    role="dialog"
                    aria-label="Event filters"
                    className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
                >
                    <div className="mb-2 flex items-center justify-between">
                        <p className={`${microBadge} text-gray-500`}>Filters</p>
                        {activeCount > 0 ? (
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
            ) : null}
        </div>
    );
}
