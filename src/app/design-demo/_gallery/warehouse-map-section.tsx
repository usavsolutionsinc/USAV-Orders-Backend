'use client';

/**
 * Warehouse map (interactive) — showroom section.
 *
 * Page-mode card hosting the react-konva canvas. The canvas is loaded with
 * next/dynamic({ ssr: false }) because konva needs `window`; everything else
 * (shell, copy, theming) renders normally and stays on the design-system tokens.
 *
 * Promotes to: src/components/warehouse/WarehouseMapCanvas.tsx, wired into
 * WarehouseShell's map tab as a `?view=interactive` mode alongside the existing
 * fill/age/issues table.
 */

import dynamic from 'next/dynamic';
import type { Density } from './sections';

const WarehouseMapCanvas = dynamic(
  () => import('./warehouse-map-canvas').then((m) => m.WarehouseMapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-xl bg-surface-canvas/60 ring-1 ring-border-soft text-[13px] text-text-muted">
        Loading interactive map…
      </div>
    ),
  },
);

export function WarehouseMapSection({ density }: { density: Density }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">Interactive warehouse map</h3>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">
            @/components/warehouse/WarehouseMapCanvas · react-konva
          </code>
        </div>
        <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-500/20">
          2026 · New
        </span>
      </div>
      <div className="rounded-xl bg-surface-canvas/60 p-4 ring-1 ring-border-soft/60">
        <WarehouseMapCanvas density={density} />
      </div>
      <p className="mt-2.5 text-[11px] leading-snug text-text-muted">
        The flat HTML-table map redrawn on a real canvas. Drag any bin to reposition it, select one to
        get resize handles (expand/shrink), scroll to zoom and drag empty space to pan. Flip{' '}
        <span className="font-semibold text-text-default">Trace</span> on and click a bin to light up every
        other bin holding the same SKU, with arrows drawn across zones — the &ldquo;identify &amp; follow inventory&rdquo;
        view the table can&rsquo;t do.
      </p>
    </div>
  );
}
