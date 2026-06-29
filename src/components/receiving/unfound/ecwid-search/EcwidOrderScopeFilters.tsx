'use client';

import { ShoppingCart, Wrench } from '@/components/Icons';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import type { EcwidOrderScope } from './ecwid-search-shared';
import type { EcwidProductSearchController } from './useEcwidProductSearch';

const SCOPE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All orders', icon: ShoppingCart },
  { id: 'repair_rs', label: 'Repair', icon: Wrench },
];

/** Scope chip row — Repair (-RS) vs all recent Ecwid orders (server fetch). */
export function EcwidOrderScopeFilters({ c }: { c: EcwidProductSearchController }) {
  if (c.popoverMode !== 'repair_service') return null;

  return (
    <div className="min-w-0 px-2 pb-2">
      <HorizontalButtonSlider
        variant="nav"
        dense
        overlay
        className="min-w-0"
        items={SCOPE_ITEMS}
        value={c.orderScope}
        onChange={(id) => c.setOrderScope(id as EcwidOrderScope)}
        aria-label="Ecwid order scope"
      />
    </div>
  );
}
