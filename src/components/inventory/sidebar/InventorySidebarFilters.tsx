'use client';

import { useEffect, useRef, useState } from 'react';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { SlidersHorizontal, ChevronDown } from '@/components/Icons';
import {
    INVENTORY_BUCKETS,
    INVENTORY_SEARCH_FIELDS,
    type AnyInventoryBucket,
    type AnyInventorySearchField,
    type InventoryTab,
} from '@/lib/inventory-search';
import { FIELD_ICON } from './inventory-sidebar-metadata';

export interface InventorySidebarFiltersProps {
    tab: InventoryTab;
    field: AnyInventorySearchField;
    onFieldChange: (next: AnyInventorySearchField) => void;
    buckets: AnyInventoryBucket[];
    onBucketsChange: (next: AnyInventoryBucket[]) => void;
    /** Counts per bucket id, surfaced as a `(n)` tail when available. */
    counts?: Partial<Record<string, number>>;
}
export function InventoryFilterDropdown({
    tab,
    field,
    onFieldChange,
    buckets,
    onBucketsChange,
    counts,
    onClose,
}: InventorySidebarFiltersProps & { onClose: () => void }) {
    const bucketOptions = INVENTORY_BUCKETS[tab];
    const fieldOptions = INVENTORY_SEARCH_FIELDS[tab];
    const selectedBuckets = new Set<string>(buckets);

    const toggleBucket = (id: string) => {
        const next = selectedBuckets.has(id)
            ? buckets.filter((v) => v !== id)
            : [...buckets, id as AnyInventoryBucket];
        onBucketsChange(next);
    };

    return (
        <div className="space-y-6">
            {/* Section: Search Field */}
            <div>
                <div className="mb-3 flex items-center justify-between">
                    <p className={`${microBadge} text-gray-400 font-black uppercase tracking-[0.2em]`}>Search By</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {fieldOptions.map((f) => {
                        const active = field === f.id;
                        const Icon = FIELD_ICON[f.id];
                        return (
                            <button
                                key={f.id}
                                type="button"
                                onClick={() => onFieldChange(f.id as AnyInventorySearchField)}
                                className={[
                                    'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-caption font-bold transition-all',
                                    active
                                        ? 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-500/20'
                                        : 'border-gray-100 bg-gray-50/50 text-gray-600 hover:border-gray-200 hover:bg-white hover:shadow-sm',
                                ].join(' ')}
                            >
                                {Icon && <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-gray-400'}`} />}
                                <span className="truncate">{f.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Section: Status Buckets */}
            {bucketOptions.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center justify-between pt-4 border-t border-gray-100">
                        <p className={`${microBadge} text-gray-400 font-black uppercase tracking-[0.2em]`}>Status Filters</p>
                        {buckets.length > 0 ? (
                            <button
                                type="button"
                                onClick={() => onBucketsChange([])}
                                className="text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-700"
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {bucketOptions.map((b) => {
                            const active = selectedBuckets.has(b.id);
                            const count = counts?.[b.id];
                            return (
                                <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => toggleBucket(b.id)}
                                    className={[
                                        'rounded-full border px-3.5 py-1.5 text-caption font-bold transition-all',
                                        active
                                            ? 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-500/20'
                                            : 'border-gray-100 bg-gray-50/50 text-gray-600 hover:border-gray-200 hover:bg-white hover:shadow-sm',
                                    ].join(' ')}
                                    aria-pressed={active}
                                >
                                    <span>{b.label}</span>
                                    {typeof count === 'number' ? (
                                        <span className={`ml-1.5 tabular-nums ${active ? 'text-white/70' : 'text-gray-400'}`}>
                                            {count}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="pt-2">
                <button
                    onClick={onClose}
                    className="w-full rounded-2xl bg-gray-900 py-3.5 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-black"
                >
                    Apply Filters
                </button>
            </div>
        </div>
    );
}

/** @deprecated Use {@link InventoryFilterDropdown} in the new FilterRefinementBar pattern. */
export function InventorySidebarFilters({
    tab,
    field,
    onFieldChange,
    buckets,
    onBucketsChange,
    counts,
}: InventorySidebarFiltersProps) {
    const bucketOptions = INVENTORY_BUCKETS[tab];
    const fieldOptions = INVENTORY_SEARCH_FIELDS[tab];
    const selectedBuckets = new Set<string>(buckets);
    const activeBucketCount = buckets.length;

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

    const toggleBucket = (id: string) => {
        const next = selectedBuckets.has(id)
            ? buckets.filter((v) => v !== id)
            : [...buckets, id as AnyInventoryBucket];
        onBucketsChange(next);
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
                    activeBucketCount > 0 || field !== 'all'
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-600',
                ].join(' ')}
            >
                <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {activeBucketCount > 0 ? (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-eyebrow font-bold text-white">
                            {activeBucketCount}
                        </span>
                    ) : null}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open ? (
                <div
                    role="dialog"
                    aria-label="Search filters"
                    className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
                >
                    <div className="space-y-4">
                        {/* Section: Search Field */}
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <p className={`${microBadge} text-gray-500 uppercase tracking-[0.1em]`}>Search By</p>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {fieldOptions.map((f) => {
                                    const active = field === f.id;
                                    const Icon = FIELD_ICON[f.id];
                                    return (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => onFieldChange(f.id as AnyInventorySearchField)}
                                            className={[
                                                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-micro font-bold uppercase tracking-wider transition-colors',
                                                active
                                                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                    : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-200 hover:text-gray-900',
                                            ].join(' ')}
                                        >
                                            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                                            <span className="truncate">{f.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Section: Status Buckets */}
                        {bucketOptions.length > 0 && (
                            <div>
                                <div className="mb-2 flex items-center justify-between pt-1 border-t border-gray-100 mt-1">
                                    <p className={`${microBadge} text-gray-500 uppercase tracking-[0.1em] pt-3`}>Status Filters</p>
                                    {activeBucketCount > 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => onBucketsChange([])}
                                            className={`${microBadge} text-blue-600 hover:underline pt-3`}
                                        >
                                            Clear
                                        </button>
                                    ) : null}
                                </div>
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {bucketOptions.map((b) => {
                                        const active = selectedBuckets.has(b.id);
                                        const count = counts?.[b.id];
                                        return (
                                            <button
                                                key={b.id}
                                                type="button"
                                                onClick={() => toggleBucket(b.id)}
                                                className={[
                                                    'rounded-full border px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-wide transition-colors',
                                                    active
                                                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                        : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-blue-200 hover:text-blue-600',
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
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
