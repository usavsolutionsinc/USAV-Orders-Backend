'use client';

import { useSearchParams } from 'next/navigation';
import { PulseView } from './PulseView';
import { BySkuView } from './BySkuView';
import { ByBinView } from './ByBinView';
import { ByUnitView } from './ByUnitView';
import { ByFilterResultList } from './ByFilterResultList';
import { useInventoryUrlState } from './useInventoryUrlState';
import { InventoryDetailsOverlay } from './panels/InventoryDetailsOverlay';
import { ReplenishWorkspace } from '@/components/replenish/ReplenishWorkspace';
import { PageHeader } from '@/components/ui/pane-header';
import { cn } from '@/utils/_cn';
import { receivingHeaderHairlineClass } from '@/components/layout/header-shell';

export function InventoryShell() {
    const { state, sidebar, clearAll } = useInventoryUrlState();
    const searchParams = useSearchParams();

    // `?section=replenish` swaps the whole right pane over to the replenish
    // workspace (Need to Order / FIFO). The replenish controls live in the
    // sidebar (ReplenishSidebarPanel), mounted by InventorySidebarPanel for
    // the same section. Default/absent section = the inventory views below.
    if (searchParams.get('section') === 'replenish') {
        return (
            <div className="flex h-full min-h-0 flex-col bg-gray-50">
                <ReplenishWorkspace />
            </div>
        );
    }

    const hasNonFilterTarget =
        state.view === 'by-sku' || state.view === 'by-bin' || state.view === 'by-unit';
    const hasAnyTarget = hasNonFilterTarget || state.view === 'by-filter';
    const hasOpenDetail = Boolean(sidebar.open);

    // When the sidebar has a detail selection, the detail view becomes the
    // main pane's content — no header chrome, no max-width container, so the
    // panel's own header takes over the top of the right pane.
    if (hasOpenDetail) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-white">
                <InventoryDetailsOverlay />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-gray-50">
            <PageHeader
                className={cn('border-transparent bg-white', receivingHeaderHairlineClass)}
                maxWidth="5xl"
                title="Inventory"
                rightSlot={
                    hasAnyTarget ? (
                        <button
                            type="button"
                            onClick={clearAll}
                            className="text-xs text-gray-500 underline hover:text-gray-900"
                        >
                            Back to recent activity
                        </button>
                    ) : null
                }
            />

            <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto">
                {state.view === 'by-sku' && state.sku ? (
                    <BySkuView sku={state.sku} />
                ) : state.view === 'by-bin' && state.bin ? (
                    <ByBinView barcode={state.bin} />
                ) : state.view === 'by-unit' && state.unit ? (
                    <ByUnitView ref={state.unit} />
                ) : state.view === 'by-filter' ? (
                    <ByFilterResultList
                        states={state.states}
                        conditions={state.conditions}
                    />
                ) : (
                    <PulseView />
                )}
            </div>
        </div>
    );
}
