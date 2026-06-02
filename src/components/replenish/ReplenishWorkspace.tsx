'use client';

import { useSearchParams } from 'next/navigation';
import { ReplenishmentNeedTable } from '@/components/replenish/ReplenishmentNeedTable';
import { ReplenishmentShippedFifoTab } from '@/components/replenish/ReplenishmentShippedFifoTab';

type ReplenishTab = 'need' | 'fifo';

/**
 * Main-pane content for the Replenish section of `/inventory`
 * (`?section=replenish`). The replenish controls — sub-tab pills, SKU search,
 * pipeline filter, Zoho sync — live in `ReplenishSidebarPanel`; this component
 * just renders the table for the active sub-tab.
 *
 * Params are namespaced (`rtab`/`rsku`/`rstatus`) so they don't collide with
 * the inventory section's own `sku`/`tab` semantics when both share `/inventory`.
 *
 * The old `incoming` tab was dropped — incoming POs already live on
 * `/receiving?mode=incoming`.
 */
export function ReplenishWorkspace() {
  const searchParams = useSearchParams();
  const tab: ReplenishTab = searchParams.get('rtab') === 'fifo' ? 'fifo' : 'need';
  const skuSearch = searchParams.get('rsku') || '';
  const statusFilter = searchParams.get('rstatus') || null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'need' ? (
          <ReplenishmentNeedTable skuSearch={skuSearch} statusFilter={statusFilter} />
        ) : (
          <ReplenishmentShippedFifoTab skuSearch={skuSearch} />
        )}
      </div>
    </div>
  );
}
