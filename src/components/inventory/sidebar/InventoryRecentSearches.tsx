'use client';

import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { useInventoryRecentSearches } from '@/hooks/useInventoryRecentSearches';
import type { InventoryTab } from '@/lib/inventory-search';

export interface InventoryRecentSearchesProps {
    tab: InventoryTab;
    onSelect: (query: string) => void;
    /** Hide when there are active results so the recent list doesn't compete for attention. */
    show: boolean;
}

/**
 * Convenience wrapper around the shared `RecentSearchesList` for the
 * inventory sidebar. The store hook is exported separately so the parent
 * can push entries after each search resolves.
 */
export function InventoryRecentSearches({ tab, onSelect, show }: InventoryRecentSearchesProps) {
    const { items, visible, expanded, toggleExpanded, clear } = useInventoryRecentSearches(tab);

    if (!show || items.length === 0) return null;

    return (
        <RecentSearchesList
            items={visible}
            totalCount={items.length}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            onClear={clear}
            onSelect={onSelect}
            getMetaLabel={(item) =>
                typeof item.resultCount === 'number'
                    ? `${item.resultCount} result${item.resultCount !== 1 ? 's' : ''}`
                    : 'Reuse'
            }
        />
    );
}
