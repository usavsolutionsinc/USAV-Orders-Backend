'use client';

import { InventorySidebar } from '@/components/inventory/sidebar/InventorySidebar';

/**
 * Sidebar panel for the inventory area.
 *
 * Renders the tabbed inventory sidebar (Phase 1+): six tabs
 * (Activity · Bins · SKUs · Units · Alerts · Counts) with scoped-search
 * field pills, multi-select bucket filter chips, debounced TanStack
 * search, recent-searches per tab, cross-tab handoff card, and slide-in
 * detail panels via the inventory-events channel.
 */
export function InventorySidebarPanel() {
    return (
        <div className="flex h-full flex-col overflow-hidden bg-white">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <InventorySidebar embedded />
            </div>
        </div>
    );
}
