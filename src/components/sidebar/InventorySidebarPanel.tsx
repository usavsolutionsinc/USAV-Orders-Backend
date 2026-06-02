'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { InventorySidebar } from '@/components/inventory/sidebar/InventorySidebar';
import { ReplenishSidebarPanel } from '@/components/sidebar/ReplenishSidebarPanel';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { Package, RefreshCw } from '@/components/Icons';

type InventorySection = 'inventory' | 'replenish';

const SECTION_ITEMS: HorizontalSliderItem[] = [
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'replenish', label: 'Replenish', icon: RefreshCw },
];

/**
 * Sidebar panel for the inventory area.
 *
 * Top band is a section toggle (Inventory ↔ Replenish) driven by
 * `?section=`. The main pane (InventoryShell) switches on the same param.
 *
 *   - Inventory: the tabbed inventory sidebar — six tabs (Activity · Bins ·
 *     SKUs · Units · Alerts · Counts) with scoped-search field pills,
 *     multi-select bucket filters, recent-searches, and slide-in detail panels.
 *   - Replenish: the replenish controls (Need to Order / FIFO sub-tabs,
 *     SKU search, pipeline filter, Zoho sync). Folded in from the retired
 *     `/replenish` route; the redundant "Incoming" tab was dropped since
 *     incoming POs already live on `/receiving?mode=incoming`.
 */
export function InventorySidebarPanel() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const section: InventorySection =
        searchParams.get('section') === 'replenish' ? 'replenish' : 'inventory';

    const setSection = (next: InventorySection) => {
        if (next === 'replenish') {
            const params = new URLSearchParams(searchParams.toString());
            params.set('section', 'replenish');
            router.push(`/inventory?${params.toString()}`);
        } else {
            // Drop section + any replenish-scoped params so the inventory views
            // come back clean (and a stale ?rsku= can't linger).
            router.push('/inventory');
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-white">
            <div className={`${sidebarHeaderBandClass} px-3`}>
                <HorizontalButtonSlider
                    items={SECTION_ITEMS}
                    value={section}
                    onChange={(id) => setSection(id as InventorySection)}
                    variant="nav"
                    aria-label="Inventory section"
                />
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                {section === 'replenish' ? (
                    <ReplenishSidebarPanel />
                ) : (
                    <div className="h-full overflow-y-auto">
                        <InventorySidebar embedded />
                    </div>
                )}
            </div>
        </div>
    );
}
