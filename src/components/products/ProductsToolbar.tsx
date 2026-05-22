'use client';

import { useEffect, useState } from 'react';
import { Search, Plus, X } from '@/components/Icons';
import { PaneHeader } from '@/components/ui/pane-header';

export type ActiveFilter = 'all' | 'active' | 'inactive';

interface ProductsToolbarProps {
    q: string;
    onQChange: (next: string) => void;
    activeFilter: ActiveFilter;
    onActiveFilterChange: (next: ActiveFilter) => void;
    hasEcwid: boolean;
    onHasEcwidChange: (next: boolean) => void;
    total: number | null;
    shown: number;
}

export function ProductsToolbar({
    q,
    onQChange,
    activeFilter,
    onActiveFilterChange,
    hasEcwid,
    onHasEcwidChange,
    total,
    shown,
}: ProductsToolbarProps) {
    const [draft, setDraft] = useState(q);

    useEffect(() => {
        setDraft(q);
    }, [q]);

    useEffect(() => {
        const trimmed = draft.trim();
        if (trimmed === q) return;
        const handle = window.setTimeout(() => onQChange(trimmed), 250);
        return () => window.clearTimeout(handle);
    }, [draft, q, onQChange]);

    return (
        <PaneHeader
            className="sticky top-0 z-10 border-b border-gray-200 bg-white"
            rowClassName="flex min-h-[44px] items-center justify-between gap-4 px-4 pt-3 sm:px-6"
            maxWidth="6xl"
            leftSlot={<h1 className="text-xl font-semibold text-gray-900">Products</h1>}
            rightSlot={
                <button
                    type="button"
                    disabled
                    title="Inline product creation coming soon"
                    className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-400"
                >
                    <Plus className="h-4 w-4" />
                    New product
                </button>
            }
            belowSlot={
                <div className="flex flex-col gap-3 px-4 pb-3 sm:px-6">
                    <label className="relative block">
                        <span className="sr-only">Search products</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="Search by SKU, title, GTIN, or UPC…"
                            className="block w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        {draft ? (
                            <button
                                type="button"
                                onClick={() => setDraft('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                aria-label="Clear search"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        ) : null}
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                        <FilterPillGroup
                            value={activeFilter}
                            onChange={onActiveFilterChange}
                            options={[
                                { value: 'all', label: 'All' },
                                { value: 'active', label: 'Active' },
                                { value: 'inactive', label: 'Inactive' },
                            ]}
                        />

                        <button
                            type="button"
                            onClick={() => onHasEcwidChange(!hasEcwid)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                hasEcwid
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            Linked to Ecwid
                        </button>

                        <div className="ml-auto text-xs text-gray-500">
                            {total !== null
                                ? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`
                                : `Showing ${shown.toLocaleString()}`}
                        </div>
                    </div>
                </div>
            }
        />
    );
}

interface FilterPillGroupProps<T extends string> {
    value: T;
    onChange: (next: T) => void;
    options: Array<{ value: T; label: string }>;
}

function FilterPillGroup<T extends string>({ value, onChange, options }: FilterPillGroupProps<T>) {
    return (
        <div className="inline-flex rounded-full border border-gray-200 bg-white p-0.5">
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                                ? 'bg-gray-900 text-white'
                                : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
