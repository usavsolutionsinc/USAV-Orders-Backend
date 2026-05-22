'use client';

import { PulseView } from './PulseView';
import { BySkuView } from './BySkuView';
import { ByBinView } from './ByBinView';
import { ByUnitView } from './ByUnitView';
import { ByFilterResultList } from './ByFilterResultList';
import { useInventoryUrlState } from './useInventoryUrlState';
import { PaneHeader } from '@/components/ui/pane-header';

export function InventoryV2Shell() {
    const { state, clearAll } = useInventoryUrlState();

    const hasNonFilterTarget =
        state.view === 'by-sku' || state.view === 'by-bin' || state.view === 'by-unit';
    const hasAnyTarget = hasNonFilterTarget || state.view === 'by-filter';

    return (
        <div className="flex h-full min-h-0 flex-col bg-gray-50">
            <PaneHeader
                className="sticky top-0 z-10 border-b border-gray-200 bg-white"
                rowClassName="flex min-h-[44px] items-center justify-between gap-4 px-4 py-3 sm:px-6"
                maxWidth="5xl"
                leftSlot={<h1 className="text-xl font-semibold text-gray-900">Inventory</h1>}
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
