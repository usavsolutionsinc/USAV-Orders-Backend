'use client';

import { useRef, useState } from 'react';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { AnchoredLayer } from '@/design-system';
import { Button } from '@/design-system/primitives';
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
                            <Button
                                key={f.id}
                                variant={active ? 'primary' : 'secondary'}
                                size="md"
                                onClick={() => onFieldChange(f.id as AnyInventorySearchField)}
                                icon={Icon ? <Icon className={active ? 'text-white' : 'text-gray-400'} /> : undefined}
                                className="w-full justify-start gap-3 text-left"
                            >
                                <span className="truncate">{f.label}</span>
                            </Button>
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
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onBucketsChange([])}
                                className="text-blue-600 hover:text-blue-700"
                            >
                                Clear
                            </Button>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {bucketOptions.map((b) => {
                            const active = selectedBuckets.has(b.id);
                            const count = counts?.[b.id];
                            return (
                                <Button
                                    key={b.id}
                                    variant={active ? 'primary' : 'secondary'}
                                    size="sm"
                                    onClick={() => toggleBucket(b.id)}
                                    className="rounded-full"
                                    aria-pressed={active}
                                >
                                    <span>{b.label}</span>
                                    {typeof count === 'number' ? (
                                        <span className={`ml-1.5 tabular-nums ${active ? 'text-white/70' : 'text-gray-400'}`}>
                                            {count}
                                        </span>
                                    ) : null}
                                </Button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="pt-2">
                <Button
                    variant="brand"
                    size="lg"
                    onClick={onClose}
                    className="w-full"
                >
                    Apply Filters
                </Button>
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

    const toggleBucket = (id: string) => {
        const next = selectedBuckets.has(id)
            ? buckets.filter((v) => v !== id)
            : [...buckets, id as AnyInventoryBucket];
        onBucketsChange(next);
    };

    return (
        <div ref={rootRef} className="relative w-full">
            {/* ds-raw-button: anchored-popover trigger with active/badge/chevron state, not a DS Button */}
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

            <AnchoredLayer
                open={open}
                onClose={() => setOpen(false)}
                anchorRef={rootRef}
                placement="bottom-stretch"
                gap={4}
            >
                <div
                    role="dialog"
                    aria-label="Search filters"
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
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
                                        <Button
                                            key={f.id}
                                            variant={active ? 'primary' : 'secondary'}
                                            size="sm"
                                            onClick={() => onFieldChange(f.id as AnyInventorySearchField)}
                                            icon={Icon ? <Icon /> : undefined}
                                            className="w-full justify-start gap-2 text-left"
                                        >
                                            <span className="truncate">{f.label}</span>
                                        </Button>
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
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => onBucketsChange([])}
                                            className={`${microBadge} text-blue-600 hover:underline pt-3`}
                                        >
                                            Clear
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {bucketOptions.map((b) => {
                                        const active = selectedBuckets.has(b.id);
                                        const count = counts?.[b.id];
                                        return (
                                            <Button
                                                key={b.id}
                                                variant={active ? 'primary' : 'secondary'}
                                                size="sm"
                                                onClick={() => toggleBucket(b.id)}
                                                className="rounded-full"
                                                aria-pressed={active}
                                            >
                                                <span>{b.label}</span>
                                                {typeof count === 'number' ? (
                                                    <span className="ml-1 text-gray-400">({count})</span>
                                                ) : null}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </AnchoredLayer>
        </div>
    );
}
