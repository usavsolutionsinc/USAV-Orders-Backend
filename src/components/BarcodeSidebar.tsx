'use client';

import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import MultiSkuSnBarcode from './MultiSkuSnBarcode';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { useEffect, useState } from 'react';
import type { SkuView } from '@/components/sku/SkuBrowser';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';

interface BarcodeSidebarProps {
    embedded?: boolean;
}

export default function BarcodeSidebar({ embedded = false }: BarcodeSidebarProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const currentSearch = searchParams.get('search') || '';
    const [searchInput, setSearchInput] = useState(currentSearch);
    const view = (searchParams.get('view') === 'sku_history' ? 'sku_history' : 'sku_stock') as SkuView;

    useEffect(() => {
        setSearchInput(currentSearch);
    }, [currentSearch]);

    useEffect(() => {
        const trimmed = searchInput.trim();
        if (trimmed === currentSearch) {
            return;
        }

        const handle = window.setTimeout(() => {
            const nextParams = new URLSearchParams(searchParams.toString());
            if (trimmed) {
                nextParams.set('search', trimmed);
            } else {
                nextParams.delete('search');
            }
            const nextSearch = nextParams.toString();
            router.replace(nextSearch ? `/sku-stock?${nextSearch}` : '/sku-stock');
        }, 250);

        return () => window.clearTimeout(handle);
    }, [currentSearch, router, searchInput, searchParams]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05,
                delayChildren: 0.05,
            },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
        visible: {
            opacity: 1,
            x: 0,
            filter: 'blur(0px)',
            transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
        },
    };

    const handleUseFavorite = (favorite: FavoriteSkuRecord) => {
        const nextSearchValue = favorite.sku || favorite.label;
        setSearchInput(nextSearchValue);
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set('search', nextSearchValue);
        const nextSearch = nextParams.toString();
        router.replace(nextSearch ? `/sku-stock?${nextSearch}` : '/sku-stock');
    };

    const content = (
        <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden">
            <motion.div variants={itemVariants} className="border-b border-gray-200 bg-white">
                <ViewDropdown
                    options={[
                        { value: 'sku_stock', label: 'SKU STOCK' },
                        { value: 'sku_history', label: 'SKU HISTORY' },
                    ]}
                    value={view}
                    onChange={(nextView) => {
                        const nextParams = new URLSearchParams(searchParams.toString());
                        nextParams.set('view', nextView);
                        const nextSearch = nextParams.toString();
                        router.replace(nextSearch ? `/sku-stock?${nextSearch}` : '/sku-stock');
                    }}
                />
            </motion.div>
            <motion.div variants={itemVariants} className="border-b border-gray-100 p-4 bg-white">
                <SearchBar
                    value={searchInput}
                    onChange={setSearchInput}
                    onSearch={(value) => {
                        const nextParams = new URLSearchParams(searchParams.toString());
                        const trimmed = value.trim();
                        if (trimmed) {
                            nextParams.set('search', trimmed);
                        } else {
                            nextParams.delete('search');
                        }
                        const nextSearch = nextParams.toString();
                        router.replace(nextSearch ? `/sku-stock?${nextSearch}` : '/sku-stock');
                    }}
                    onClear={() => {
                        setSearchInput('');
                        const nextParams = new URLSearchParams(searchParams.toString());
                        nextParams.delete('search');
                        const nextSearch = nextParams.toString();
                        router.replace(nextSearch ? `/sku-stock?${nextSearch}` : '/sku-stock');
                    }}
                    placeholder={view === 'sku_stock' ? 'Search stock, sku, or product title...' : 'Search sku, serial, location, tracking, notes...'}
                    isSearching={false}
                    variant="blue"
                />
            </motion.div>
            <motion.div variants={itemVariants} className="flex-1 overflow-y-auto scrollbar-hide px-4 py-4 space-y-4">
                <FavoritesWorkspaceSection
                    workspaceKey="sku-stock"
                    accent="blue"
                    title="Favorites"
                    description=""
                    emptyLabel="No SKU stock favorites yet"
                    useLabel="Search SKU"
                    inlineRows
                    buttonAccent="blue"
                    onUseFavorite={handleUseFavorite}
                />
                <MultiSkuSnBarcode />
            </motion.div>
            <motion.footer variants={itemVariants} className="p-4 border-t border-gray-100 opacity-30 mt-auto text-center">
                <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV GEN</p>
            </motion.footer>
        </motion.div>
    );

    if (embedded) {
        return <div className="h-full overflow-hidden bg-white">{content}</div>;
    }

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group w-[400px]">
                {content}
            </aside>
        </div>
    );
}
