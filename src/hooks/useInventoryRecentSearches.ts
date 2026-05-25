'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InventoryTab } from '@/lib/inventory-search';

export interface RecentInventorySearch {
    query: string;
    field: string;
    timestamp: string;
    resultCount?: number;
}

const MAX_STORED = 25;
const VISIBLE_DEFAULT = 3;
const VISIBLE_EXPANDED = 5;

function storageKey(tab: InventoryTab): string {
    return `inventory_search_history_${tab}`;
}

function readStorage(tab: InventoryTab): RecentInventorySearch[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(storageKey(tab));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((it): it is RecentInventorySearch => it && typeof it.query === 'string')
            .slice(0, MAX_STORED);
    } catch {
        return [];
    }
}

function writeStorage(tab: InventoryTab, items: RecentInventorySearch[]) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(storageKey(tab), JSON.stringify(items.slice(0, MAX_STORED)));
    } catch {
        /* localStorage is non-essential; ignore quota errors */
    }
}

/**
 * Per-tab recent-searches store. Each tab gets its own localStorage bucket
 * keyed by `inventory_search_history_${tab}` — switching tabs swaps the list
 * cleanly so SKU history doesn't bleed into Bins or vice versa.
 */
export function useInventoryRecentSearches(tab: InventoryTab) {
    const [items, setItems] = useState<RecentInventorySearch[]>([]);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        setItems(readStorage(tab));
        setExpanded(false);
    }, [tab]);

    const push = useCallback(
        (entry: Omit<RecentInventorySearch, 'timestamp'>) => {
            if (!entry.query?.trim()) return;
            const next: RecentInventorySearch[] = [
                { ...entry, timestamp: new Date().toISOString() },
                ...items.filter((it) => it.query.toLowerCase() !== entry.query.toLowerCase()),
            ].slice(0, MAX_STORED);
            setItems(next);
            writeStorage(tab, next);
        },
        [items, tab],
    );

    const clear = useCallback(() => {
        setItems([]);
        setExpanded(false);
        writeStorage(tab, []);
    }, [tab]);

    const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

    const visible = expanded ? items.slice(0, VISIBLE_EXPANDED) : items.slice(0, VISIBLE_DEFAULT);

    return { items, visible, expanded, toggleExpanded, push, clear };
}
