'use client';

import React from 'react';
import { AnchoredLayer } from '@/design-system';
import { useSkuParents, useSkuChildren } from '@/components/inventory/graph/useSkuGraph';
import type { SkuRelationshipEdgeView } from '@/components/inventory/graph/types';
import { Package, MapPin, ShoppingCart, Link2, Sparkles, Box } from '@/components/Icons';
import { timeAgo } from '@/utils/_date';
import { useSimilarProducts, type SimilarProduct } from './types';
import type { Allocation, LocationDetail, StockSummary, UnitDetail } from './types';

// ─── Shell ───────────────────────────────────────────────────────────────────

interface PopoverChrome {
  /** The header's `relative` trigger wrapper to pin the panel under. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Routed to AnchoredLayer's click-away + Escape. */
  onClose: () => void;
}

/**
 * Anchored popover panel. Portaled to <body> via AnchoredLayer so a high
 * z-index can never be trapped by an ancestor stacking context; pinned
 * below-right of the header's trigger `relative` wrapper (`anchorRef`). Callers
 * mount the shell only while their popover is open, so `open` is constant true;
 * AnchoredLayer owns click-away + Escape and routes them through `onClose`.
 */
export function PopoverShell({
  title,
  icon,
  width = 'w-80',
  anchorRef,
  onClose,
  children,
}: PopoverChrome & {
  title: string;
  icon: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <AnchoredLayer
      open
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-end"
      gap={6}
    >
      <div
        role="dialog"
        className={`${width} overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl`}
      >
        <div className="flex h-9 items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-3">
          <span className="text-gray-400">{icon}</span>
          <span className="text-eyebrow font-black uppercase tracking-[0.16em] text-gray-500">
            {title}
          </span>
        </div>
        <div className="max-h-[58vh] overflow-y-auto">{children}</div>
      </div>
    </AnchoredLayer>
  );
}

function PopoverEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-caption font-medium text-gray-400">{children}</p>
  );
}

function PopoverLoading() {
  return (
    <p className="px-3 py-6 text-center text-caption font-semibold text-gray-400">Loading…</p>
  );
}

// ─── Inventory linkage ───────────────────────────────────────────────────────

/**
 * Inventory linkage — stock-on-hand, resolved bin, and active order
 * allocation. Fed entirely from the already-fetched unit detail (no second
 * request); the header just toggles visibility.
 */
export function InventoryLinkagePopover({
  unit,
  stock,
  locationDetail,
  allocation,
  anchorRef,
  onClose,
}: PopoverChrome & {
  unit: UnitDetail;
  stock: StockSummary | null | undefined;
  locationDetail: LocationDetail | null | undefined;
  allocation: Allocation | null;
}) {
  const stocked = !!(unit.current_location && unit.current_location.trim());
  return (
    <PopoverShell title="Inventory linkage" icon={<Package className="h-3.5 w-3.5" />} anchorRef={anchorRef} onClose={onClose}>
      <div className="divide-y divide-gray-100">
        {/* On-hand */}
        <div className="px-3 py-3">
          <p className="text-eyebrow font-black uppercase tracking-[0.16em] text-gray-400">
            On hand · {unit.sku ?? '—'}
          </p>
          <div className="mt-2 flex gap-2">
            <StatTile label="Loose" value={stock ? stock.stock : 0} icon={<Package className="h-3.5 w-3.5" />} />
            <StatTile label="Boxed" value={stock ? stock.boxed_stock : 0} icon={<Box className="h-3.5 w-3.5" />} />
          </div>
        </div>

        {/* Location */}
        <Row
          icon={<MapPin className="h-4 w-4" />}
          active={stocked}
          title={stocked ? unit.current_location! : 'Not stocked'}
          sub={
            locationDetail
              ? [locationDetail.room, locationDetail.zone_letter ? `Zone ${locationDetail.zone_letter}` : null, locationDetail.bin_type]
                  .filter(Boolean)
                  .join(' · ') || 'Current bin'
              : stocked
                ? 'Current bin'
                : 'No bin assigned yet'
          }
        />

        {/* Allocation */}
        <Row
          icon={<ShoppingCart className="h-4 w-4" />}
          active={!!allocation}
          title={allocation?.order_id ?? 'Unallocated'}
          sub={
            allocation
              ? `${allocation.state} · ${timeAgo(allocation.allocated_at)}`
              : 'No open order allocation'
          }
        />
      </div>
    </PopoverShell>
  );
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200/60">
      <span className="text-gray-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none text-gray-900 tabular-nums">{value}</p>
        <p className="mt-0.5 text-micro font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      </div>
    </div>
  );
}

function Row({
  icon,
  active,
  title,
  sub,
}: {
  icon: React.ReactNode;
  active: boolean;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-label font-bold text-gray-900">{title}</p>
        <p className="truncate text-micro font-medium text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

// ─── Compatibility (SKU assembly graph) ──────────────────────────────────────

/**
 * Compatibility linkage — the unit's place in the SKU assembly graph:
 * parents ("belongs to") and children ("contains"). Powered by the existing
 * sku_relationships graph via skuCatalogId.
 */
export function CompatibilityPopover({
  skuCatalogId,
  anchorRef,
  onClose,
}: PopoverChrome & { skuCatalogId: number | null }) {
  const parents = useSkuParents(skuCatalogId);
  const children = useSkuChildren(skuCatalogId);
  const loading = parents.isLoading || children.isLoading;
  const parentRows = parents.data ?? [];
  const childRows = children.data ?? [];
  const empty = !loading && parentRows.length === 0 && childRows.length === 0;

  return (
    <PopoverShell title="Compatibility linkage" icon={<Link2 className="h-3.5 w-3.5" />} width="w-[22rem]" anchorRef={anchorRef} onClose={onClose}>
      {!skuCatalogId ? (
        <PopoverEmpty>This unit isn't linked to a catalog SKU, so it has no assembly graph.</PopoverEmpty>
      ) : loading ? (
        <PopoverLoading />
      ) : empty ? (
        <PopoverEmpty>No assembly relationships defined for this SKU yet.</PopoverEmpty>
      ) : (
        <div className="divide-y divide-gray-100">
          <EdgeSection label="Belongs to" empty="Not part of any assembly" rows={parentRows} />
          <EdgeSection label="Contains" empty="No component parts" rows={childRows} />
        </div>
      )}
    </PopoverShell>
  );
}

function EdgeSection({
  label,
  empty,
  rows,
}: {
  label: string;
  empty: string;
  rows: SkuRelationshipEdgeView[];
}) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 pt-2 text-eyebrow font-black uppercase tracking-[0.16em] text-gray-400">
        {label} · {rows.length}
      </p>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-micro font-medium text-gray-400">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <ProductMiniRow
              key={r.relationship_id}
              title={r.product_title || r.sku}
              sku={r.sku}
              imageUrl={r.image_url}
              stock={r.stock}
              trailing={r.qty > 1 ? `×${r.qty}` : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Similar products (same category) ────────────────────────────────────────

export function SimilarProductsPopover({
  skuCatalogId,
  anchorRef,
  onClose,
}: PopoverChrome & { skuCatalogId: number | null }) {
  const { data, isLoading } = useSimilarProducts(skuCatalogId);
  const items: SimilarProduct[] = data?.items ?? [];

  return (
    <PopoverShell title="Similar products" icon={<Sparkles className="h-3.5 w-3.5" />} width="w-[22rem]" anchorRef={anchorRef} onClose={onClose}>
      {!skuCatalogId ? (
        <PopoverEmpty>This unit isn't linked to a catalog SKU.</PopoverEmpty>
      ) : isLoading ? (
        <PopoverLoading />
      ) : !data?.category ? (
        <PopoverEmpty>No category set on this SKU — can't suggest similar products.</PopoverEmpty>
      ) : items.length === 0 ? (
        <PopoverEmpty>No other products in “{data.category}”.</PopoverEmpty>
      ) : (
        <div className="py-1">
          <p className="px-3 pb-1 pt-2 text-eyebrow font-black uppercase tracking-[0.16em] text-gray-400">
            Category · {data.category}
          </p>
          <ul>
            {items.map((p) => (
              <ProductMiniRow
                key={p.sku_id}
                title={p.product_title || p.sku}
                sku={p.sku}
                imageUrl={p.image_url}
                stock={p.stock}
              />
            ))}
          </ul>
        </div>
      )}
    </PopoverShell>
  );
}

// ─── Shared mini product row ─────────────────────────────────────────────────

function ProductMiniRow({
  title,
  sku,
  imageUrl,
  stock,
  trailing,
}: {
  title: string;
  sku: string;
  imageUrl: string | null;
  stock: number;
  trailing?: string;
}) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50 ring-1 ring-gray-200">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Package className="h-4 w-4 text-gray-300" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-1 text-label font-semibold text-gray-900">{title}</span>
        <span className="truncate font-mono text-micro text-gray-500">
          {sku} · {stock} on hand
        </span>
      </span>
      {trailing ? (
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-micro font-bold text-gray-600">
          {trailing}
        </span>
      ) : null}
    </li>
  );
}

// ─── Header popover state (click-away + Escape) ──────────────────────────────

export type HeaderPopoverKey = 'inventory' | 'compatibility' | 'similar';

export function useHeaderPopover(): {
  open: HeaderPopoverKey | null;
  toggle: (key: HeaderPopoverKey) => void;
  close: () => void;
} {
  // Dismissal (click-away + Escape) is owned by AnchoredLayer inside
  // PopoverShell — the header just passes `close` through as its onClose.
  const [open, setOpen] = React.useState<HeaderPopoverKey | null>(null);

  return {
    open,
    toggle: (key) => setOpen((cur) => (cur === key ? null : key)),
    close: () => setOpen(null),
  };
}
