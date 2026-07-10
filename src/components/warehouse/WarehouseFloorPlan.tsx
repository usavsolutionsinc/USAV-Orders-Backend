'use client';

/**
 * Warehouse floor plan — React Flow (@xyflow/react) renderer for the map tab.
 *
 * Phase 1 (read-only): bins as DOM nodes auto-laid from room/row/col grid
 * coordinates (floor-layout.ts), colored by the shared map tone SoT
 * (map-tones.ts — the exact logic the flat table uses), with pan/zoom,
 * Controls and MiniMap. Clicking a bin opens the existing BinDetailFlyout via
 * `onCellClick` (parent owns selection). No dragging, no persistence — those
 * are Phase 3 (docs/todo/warehouse-map-react-flow-plan.md §9).
 *
 * Canvas archetype: the graph is the map — it pans/zooms directly and is
 * never crossfaded; detail opens in the flyout. Zone nodes are emitted before
 * bin nodes so bins paint on top (document order — no stacking overrides).
 */

import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BinsOverviewRow } from '@/hooks/useBinsOverview';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { buildFloorLayout } from './floor-layout';
import { cellTone, cellValue, cellLabel, type MapViewMode } from './map-tones';

/* ─────────────────────────── node data + types ─────────────────────────── */

type BinData = {
  row: BinsOverviewRow;
  mode: MapViewMode;
  /** Empty bin with `showEmpty` off → rendered at reduced opacity. */
  faded: boolean;
};

type ZoneData = {
  room: string;
  letter: string | null;
  binCount: number;
  colLabels: string[];
  rowLabels: string[];
  relGridX: number;
  relGridY: number;
  cell: number;
  gap: number;
};

type BinNodeT = Node<BinData, 'bin'>;
type ZoneNodeT = Node<ZoneData, 'zone'>;
type FloorNode = BinNodeT | ZoneNodeT;

/* ───────────────────────────── custom nodes ────────────────────────────── */

function BinNode({ data }: NodeProps<BinNodeT>) {
  const tone = cellTone(data.row, data.mode);
  const label = cellLabel(data.row);
  return (
    <HoverTooltip label={label} focusable={false} asChild>
      <div
        role="img"
        aria-label={label}
        className={`flex h-full w-full cursor-pointer items-center justify-center rounded-md text-micro font-semibold tabular-nums transition-opacity ${tone} ${
          data.faded ? 'opacity-30 hover:opacity-100' : ''
        }`}
      >
        {cellValue(data.row, data.mode)}
      </div>
    </HoverTooltip>
  );
}

function ZoneNode({ data }: NodeProps<ZoneNodeT>) {
  return (
    <div className="relative h-full w-full rounded-2xl border border-border-soft bg-surface-card">
      <span className="absolute left-4 top-2.5 flex items-baseline gap-2 text-caption font-semibold text-text-default">
        {data.room}
        {data.letter && (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-50 font-mono text-mini font-semibold text-blue-700 ring-1 ring-blue-200">
            {data.letter}
          </span>
        )}
      </span>
      <span className="absolute right-3 top-2.5 text-eyebrow font-bold uppercase tracking-wider text-text-faint">
        {data.binCount} bin{data.binCount === 1 ? '' : 's'}
      </span>
      {data.colLabels.map((c, ci) => (
        <span
          key={c}
          className="absolute text-center text-eyebrow font-bold uppercase tracking-wider text-text-faint"
          style={{ left: data.relGridX + ci * (data.cell + data.gap), top: data.relGridY - 14, width: data.cell }}
        >
          {c}
        </span>
      ))}
      {data.rowLabels.map((r, ri) => (
        <span
          key={r}
          className="absolute text-eyebrow font-bold uppercase tracking-wider text-text-faint"
          style={{ left: 12, top: data.relGridY + ri * (data.cell + data.gap) + data.cell / 2 - 6 }}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

// Module-scope so React Flow never sees a new nodeTypes identity per render.
const nodeTypes = { bin: BinNode, zone: ZoneNode };

/* ─────────────────────────── layout → nodes ────────────────────────────── */

function toFlowNodes(rows: BinsOverviewRow[], mode: MapViewMode, showEmpty: boolean): FloorNode[] {
  const { bins, zones } = buildFloorLayout(rows);
  const zoneNodes: ZoneNodeT[] = zones.map((z) => ({
    id: `zone-${z.room}`,
    type: 'zone',
    position: { x: z.x, y: z.y },
    data: {
      room: z.room,
      letter: z.letter,
      binCount: z.binCount,
      colLabels: z.colLabels,
      rowLabels: z.rowLabels,
      relGridX: z.relGridX,
      relGridY: z.relGridY,
      cell: z.cell,
      gap: z.gap,
    },
    style: { width: z.w, height: z.h },
    draggable: false,
    selectable: false,
    deletable: false,
  }));
  const binNodes: BinNodeT[] = bins.map((b) => ({
    id: `bin-${b.row.id}`,
    type: 'bin',
    position: { x: b.x, y: b.y },
    data: { row: b.row, mode, faded: !showEmpty && b.row.is_empty },
    style: { width: b.w, height: b.h },
    draggable: false,
    deletable: false,
  }));
  return [...zoneNodes, ...binNodes];
}

/* ──────────────────────────────── surface ──────────────────────────────── */

interface Props {
  rows: BinsOverviewRow[];
  loading: boolean;
  /** Bins fetch error — the map degrades to a retry-later notice, never throws. */
  error?: Error | null;
  mode: MapViewMode;
  showEmpty: boolean;
  onCellClick: (row: BinsOverviewRow) => void;
}

export function WarehouseFloorPlan({ rows, loading, error = null, mode, showEmpty, onCellClick }: Props) {
  const nodes = useMemo(() => toFlowNodes(rows, mode, showEmpty), [rows, mode, showEmpty]);
  const hasBins = nodes.some((n) => n.type === 'bin');

  if (loading && !hasBins) {
    return (
      <div className="rounded-2xl border border-border-soft bg-surface-card p-8 text-center text-sm text-text-faint">
        Loading floor plan…
      </div>
    );
  }

  if (error && !hasBins) {
    return (
      <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-rose-700">Could not load the floor plan</p>
        <p className="mt-1 text-xs text-rose-600">The bins overview did not respond. It will retry automatically.</p>
      </div>
    );
  }

  if (!hasBins) {
    return (
      <div className="rounded-2xl border border-dashed border-border-soft bg-surface-card p-8 text-center">
        <p className="text-sm font-semibold text-text-muted">No bins to plot</p>
        <p className="mt-1 text-xs text-text-soft">
          Bins need a room, row and column to appear on the floor plan — add them via the label printer.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[70vh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-border-soft bg-surface-card">
      <ReactFlowProvider>
        <ReactFlow<FloorNode>
          nodes={nodes}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          maxZoom={2.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_evt, n) => {
            if (n.type === 'bin') onCellClick((n as BinNodeT).data.row);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} className="!bg-surface-sunken" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
