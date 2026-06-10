'use client';

import React, { useRef } from 'react';
import { PaneHeader, PaneHeaderTitle } from '@/components/ui/pane-header';
import { receivingHeaderHairlineClass } from '@/components/layout/header-shell';
import { Printer, Package, Link2, Sparkles } from '@/components/Icons';
import {
  InventoryLinkagePopover,
  CompatibilityPopover,
  SimilarProductsPopover,
  useHeaderPopover,
} from './popovers';
import type { Allocation, LocationDetail, StockSummary, UnitDetail } from './types';

interface UnitDetailHeaderProps {
  unit: UnitDetail;
  stock?: StockSummary | null;
  locationDetail?: LocationDetail | null;
  /** The open (non-released) allocation, if any. */
  activeAllocation: Allocation | null;
}

/**
 * 40px detail-pane header (paneHeaderRowClass). Left: compact identity
 * (SKU eyebrow + serial). Right: three linkage actions, each toggling an
 * anchored popover — Inventory (stock + bin + order), Compatibility (SKU
 * assembly graph), Similar (same-category catalog). One popover open at a
 * time; click-away / Escape close via useHeaderPopover.
 */
export function UnitDetailHeader({
  unit,
  stock,
  locationDetail,
  activeAllocation,
}: UnitDetailHeaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popover = useHeaderPopover();
  const skuCatalogId = unit.sku_catalog_id ?? null;

  return (
    <PaneHeader
      // Inner (inset-shadow) bottom hairline — the canonical receiving header
      // hairline — instead of the default border, so the 40px band reads as a
      // distinct header over the gray-50 body.
      className={`bg-white border-b-0 ${receivingHeaderHairlineClass}`}
      leftSlot={
        <>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Printer className="h-3.5 w-3.5" />
          </span>
          {/* Header shows ONLY the long QR label id (the minted unit_uid); the
              SKU + real device serial live in the identity card below. */}
          <PaneHeaderTitle className="font-mono">
            {unit.unit_uid || unit.serial_number}
          </PaneHeaderTitle>
        </>
      }
      rightSlot={
        <div ref={rootRef} className="relative flex items-center gap-1">
          <ActionIconButton
            icon={<Package className="h-4 w-4" />}
            label="Inventory linkage"
            active={popover.open === 'inventory'}
            onClick={() => popover.toggle('inventory')}
          />
          <ActionIconButton
            icon={<Link2 className="h-4 w-4" />}
            label="Compatibility linkage"
            active={popover.open === 'compatibility'}
            onClick={() => popover.toggle('compatibility')}
          />
          <ActionIconButton
            icon={<Sparkles className="h-4 w-4" />}
            label="Similar products"
            active={popover.open === 'similar'}
            onClick={() => popover.toggle('similar')}
          />

          {popover.open === 'inventory' && (
            <InventoryLinkagePopover
              unit={unit}
              stock={stock}
              locationDetail={locationDetail}
              allocation={activeAllocation}
              anchorRef={rootRef}
              onClose={popover.close}
            />
          )}
          {popover.open === 'compatibility' && (
            <CompatibilityPopover skuCatalogId={skuCatalogId} anchorRef={rootRef} onClose={popover.close} />
          )}
          {popover.open === 'similar' && (
            <SimilarProductsPopover skuCatalogId={skuCatalogId} anchorRef={rootRef} onClose={popover.close} />
          )}
        </div>
      }
    />
  );
}

function ActionIconButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-200'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {icon}
    </button>
  );
}
