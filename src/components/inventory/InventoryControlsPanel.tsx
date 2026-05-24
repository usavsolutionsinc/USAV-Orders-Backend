'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { InventorySearchBar, type ResolvedSearchTarget } from './InventorySearchBar';
import { InventoryFilterChips } from './InventoryFilterChips';
import { useInventoryUrlState } from './useInventoryUrlState';

/**
 * Sidebar-embedded inventory controls: search bar + state/condition chips.
 *
 * Lives in the sidebar so the ledger viewport stays focused on results.
 * URL writes always target `/inventory` (see useInventoryUrlState), so a
 * search submitted from the PO Mailbox tab navigates back to the ledger.
 */
export function InventoryControlsPanel() {
    const { state, setUrl } = useInventoryUrlState();

    const initialSearchValue = state.sku || state.bin || state.unit || '';

    const handleSubmit = useCallback(
        (target: ResolvedSearchTarget) => {
            switch (target.kind) {
                case 'clear':
                    setUrl({ sku: null, bin: null, unit: null });
                    return;
                case 'sku':
                    setUrl({ sku: target.sku });
                    return;
                case 'bin':
                    setUrl({ bin: target.barcode });
                    return;
                case 'unit':
                    setUrl({ unit: target.ref });
                    return;
                case 'tracking':
                    toast.message('Tracking lookup', {
                        description: `Detected ${target.carrier ?? 'tracking'} — open the order in Operations.`,
                    });
                    return;
                case 'unknown':
                default:
                    toast.message('No match', {
                        description: 'Try a SKU code, bin barcode (e.g., A-12-03), or a unit id / serial.',
                    });
                    return;
            }
        },
        [setUrl],
    );

    return (
        <div className="space-y-2">
            <InventorySearchBar
                initial={initialSearchValue}
                onSubmit={handleSubmit}
            />
            <InventoryFilterChips
                states={state.states}
                conditions={state.conditions}
                onChange={(patch) => setUrl(patch)}
                onClear={() => setUrl({ states: [], conditions: [] })}
            />
        </div>
    );
}
