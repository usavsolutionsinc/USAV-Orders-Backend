'use client';

import { useState } from 'react';
import { Search } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import type { InventoryResultRow } from '@/hooks/useInventorySearch';
import { InventoryResultCard } from './InventoryResultCard';

export interface InventoryResultListProps {
    rows: InventoryResultRow[];
    isFetching: boolean;
    hasQuery: boolean;
    /** Returns true when the given row matches the current overlay selection. */
    isRowActive?: (row: InventoryResultRow) => boolean;
    onSelect: (row: InventoryResultRow) => void;
    onClearQuery: () => void;
    /** Header text — defaults to `"N Results"`. */
    label?: string;
    /** Empty-state placeholder shown when not searching and there are no rows. */
    emptyPlaceholder?: React.ReactNode;
}

export function InventoryResultList({
    rows,
    isFetching,
    hasQuery,
    isRowActive,
    onSelect,
    onClearQuery,
    label,
    emptyPlaceholder,
}: InventoryResultListProps) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const handleCopy = (key: string, text: string) => {
        try {
            void navigator.clipboard?.writeText(text);
        } catch {
            /* clipboard rejection is benign — copy is opportunistic */
        }
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    };

    if (rows.length === 0) {
        if (hasQuery && !isFetching) {
            return (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 text-center animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Search className="w-6 h-6 text-blue-600" />
                    </div>
                    <h3 className="text-sm font-black text-blue-900 uppercase tracking-tight mb-1">No matches</h3>
                    <p className={`${sectionLabel} text-blue-700 leading-relaxed`}>
                        Try a different field or clear filters.
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-3">
                        <Button
                            variant="secondary"
                            onClick={onClearQuery}
                            className="bg-surface-card text-blue-700 ring-blue-200 hover:bg-blue-100"
                        >
                            Clear Search
                        </Button>
                    </div>
                </div>
            );
        }
        if (emptyPlaceholder) return <>{emptyPlaceholder}</>;
        return null;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className={`${microBadge} text-text-soft`}>
                    {label ?? `${rows.length} Result${rows.length !== 1 ? 's' : ''}`}
                </p>
                {hasQuery ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearQuery}
                        className={`${microBadge} h-auto px-0 text-blue-600 hover:bg-transparent hover:underline`}
                    >
                        Clear
                    </Button>
                ) : null}
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
                {rows.map((row) => (
                    <InventoryResultCard
                        key={`${row.kind}:${row.key}`}
                        row={row}
                        isActive={isRowActive ? isRowActive(row) : false}
                        onClick={() => onSelect(row)}
                        onCopy={(text) => handleCopy(`${row.kind}:${row.key}`, text)}
                        copied={copiedKey === `${row.kind}:${row.key}`}
                    />
                ))}
            </div>
        </div>
    );
}
