'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { InventorySidebar } from '@/components/inventory/sidebar/InventorySidebar';
import { InventoryGraphSidebar } from '@/components/inventory/sidebar/InventoryGraphSidebar';
import { InventoryTriageSidebar } from '@/components/inventory/sidebar/InventoryTriageSidebar';
import { InventoryPulseSidebar } from '@/components/inventory/sidebar/InventoryPulseSidebar';
import { ReplenishSidebarPanel } from '@/components/sidebar/ReplenishSidebarPanel';
import { sidebarHeaderBandClass, sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
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
    const pathname = usePathname();
    const searchParams = useSearchParams();
    // When the master nav owns mode switching, its L2 rail is the single
    // switcher — hide this panel's own section pills to avoid a double switcher.
    const masterNavEnabled = useMasterNavEnabled();
    const section: InventorySection =
        searchParams.get('section') === 'replenish' ? 'replenish' : 'inventory';

    // Each non-ledger inventory mode is its own route with a dedicated,
    // contextual sidebar — search + a list that drives the right pane via
    // `?open=` / `?sku=` (the sidebar-mode contract).
    if (pathname?.startsWith('/inventory/graph')) {
        return (
            <div className="flex h-full flex-col overflow-hidden bg-white">
                <InventoryGraphSidebar />
            </div>
        );
    }
    if (pathname?.startsWith('/inventory/triage')) {
        return (
            <div className="flex h-full flex-col overflow-hidden bg-white">
                <InventoryTriageSidebar />
            </div>
        );
    }
    if (pathname?.startsWith('/inventory/pulse')) {
        return (
            <div className="flex h-full flex-col overflow-hidden bg-white">
                <InventoryPulseSidebar />
            </div>
        );
    }

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
            {!masterNavEnabled && (
                <div className={sidebarHeaderPillRowClass}>
                    <HorizontalButtonSlider
                        items={SECTION_ITEMS}
                        value={section}
                        onChange={(id) => setSection(id as InventorySection)}
                        variant="nav"
                        dense
                        className="w-full"
                        aria-label="Inventory section"
                    />
                </div>
            )}

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
