'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebounce } from '@/hooks';
import { useSkuCatalogSearch } from '@/hooks/useSkuCatalogSearch';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { cn } from '@/utils/_cn';

/**
 * Sidebar panel for the SKU graph mode (`/inventory/graph`).
 *
 * Per the sidebar-mode contract, search lives HERE (the sidebar) — not on the
 * canvas toolbar. Picking a result writes `?sku=<code>` to the graph route; the
 * `SkuGraphWorkspace` already reads `?sku=` and focuses that node, so this panel
 * stays a pure URL writer (no cross-component callbacks). The right pane (canvas
 * + detail) is the visual surface.
 */
export function InventoryGraphSidebar() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const focusedSku = searchParams.get('sku');

    const [inputValue, setInputValue] = useState('');
    const debounced = useDebounce(inputValue, 250);
    const trimmed = debounced.trim();

    const { data: results = [], isFetching } = useSkuCatalogSearch(trimmed, { limit: 20 });

    const focusSku = useCallback(
        (sku: string) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set('sku', sku);
            // Preserve the active view (parents/children/tree); default it so a
            // fresh focus always renders something.
            if (!sp.get('view')) sp.set('view', 'children');
            router.replace(`/inventory/graph?${sp.toString()}`);
        },
        [router, searchParams],
    );

    const containerVariants = useMemo(
        () => ({
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
        }),
        [],
    );

    return (
        <SidebarShell
            as={motion.div}
            containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
            search={{
                value: inputValue,
                onChange: setInputValue,
                placeholder: 'Search SKU to explore…',
                isSearching: isFetching,
                variant: 'blue',
            }}
            bodyClassName="scrollbar-hide pb-5 space-y-2"
        >
            <p className={`${microBadge} px-1 text-gray-500`}>
                Search a SKU to map its parents, children, or full BOM tree.
            </p>

            {trimmed.length > 0 && results.length === 0 && !isFetching ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                    <p className={`${microBadge} text-gray-500`}>No SKUs match “{trimmed}”.</p>
                </div>
            ) : null}

            <ul className="space-y-1">
                {results.map((item) => {
                    const active = item.sku === focusedSku;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                onClick={() => focusSku(item.sku)}
                                className={cn(
                                    'flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors',
                                    active
                                        ? 'bg-blue-50 ring-1 ring-inset ring-blue-200'
                                        : 'hover:bg-gray-50',
                                )}
                            >
                                <span
                                    className={cn(
                                        'text-[13px] font-semibold',
                                        active ? 'text-blue-900' : 'text-gray-900',
                                    )}
                                >
                                    {item.sku}
                                </span>
                                <span className="line-clamp-1 text-[11px] text-gray-500">
                                    {item.product_title}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </SidebarShell>
    );
}
