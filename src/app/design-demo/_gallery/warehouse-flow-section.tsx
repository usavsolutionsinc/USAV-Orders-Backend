'use client';

/**
 * Interactive warehouse map — @xyflow/react (React Flow) version.
 *
 * The exact same bins/zones/tones as the react-konva canvas (shared via
 * ./warehouse-map-data), rebuilt on React Flow so the two can be compared
 * head-to-head:
 *   • drag    — React Flow nodes are draggable out of the box
 *   • resize  — <NodeResizer> handles appear on the selected bin (expand/shrink)
 *   • trace   — select a bin + flip Trace: same-SKU bins highlight and React Flow
 *               draws real <Edge>s between them (this is React Flow's home turf)
 *   • zoom/pan — built in, plus Controls + MiniMap for free
 *
 * Unlike konva, nodes are plain DOM, so they style straight off the
 * design-system Tailwind tokens and React Flow's own chrome themes via the
 * `colorMode` prop — no getComputedStyle color-sampling needed.
 *
 * Promotes to: src/components/warehouse/WarehouseFlowMap.tsx.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Density } from './sections';
import {
  type ViewMode,
  buildLayout,
  binTone,
  binValue,
  FILL_LEGEND,
  MIN_SIZE,
  ACCENT,
} from './warehouse-map-data';

/* ─────────────────────────── node data + types ────────────────────────── */

type BinData = {
  label: string;
  sku: string;
  fillPct: number;
  mode?: ViewMode;
  traced?: boolean;
};
type ZoneData = {
  name: string;
  letter: string;
  colLabels: string[];
  rowLabels: string[];
  cell: number;
  gap: number;
  relGridX: number;
  relGridY: number;
};
type BinNodeT = Node<BinData, 'bin'>;
type ZoneNodeT = Node<ZoneData, 'zone'>;
type AppNode = BinNodeT | ZoneNodeT;

/* ───────────────────────────── custom nodes ───────────────────────────── */

function BinNode({ data, selected }: NodeProps<BinNodeT>) {
  const tone = binTone({ fillPct: data.fillPct });
  const value = binValue({ fillPct: data.fillPct }, data.mode ?? 'fill');
  const ring = selected ? `0 0 0 3px ${ACCENT}` : data.traced ? `0 0 0 2px ${ACCENT}, 0 0 8px ${ACCENT}` : 'none';

  return (
    <>
      <NodeResizer color={ACCENT} isVisible={!!selected} minWidth={MIN_SIZE} minHeight={MIN_SIZE} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        className="flex h-full w-full items-center justify-center rounded-lg text-[11px] font-bold tabular-nums"
        style={{ background: tone.fill, color: tone.text, boxShadow: ring }}
      >
        {value}
      </div>
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
    </>
  );
}

function ZoneNode({ data }: NodeProps<ZoneNodeT>) {
  return (
    <div className="relative h-full w-full rounded-2xl border border-border-soft bg-surface-card">
      <span className="absolute left-4 top-2.5 text-[13px] font-bold text-text-default">{data.name}</span>
      <span className="absolute right-3 top-2.5 text-[11px] font-bold" style={{ color: ACCENT }}>
        {data.letter}
      </span>
      {data.colLabels.map((c, ci) => (
        <span
          key={c}
          className="absolute text-center text-[9px] font-bold uppercase tracking-wide text-text-muted"
          style={{ left: data.relGridX + ci * (data.cell + data.gap), top: data.relGridY - 14, width: data.cell }}
        >
          {c}
        </span>
      ))}
      {data.rowLabels.map((r, ri) => (
        <span
          key={r}
          className="absolute text-[9px] font-bold uppercase tracking-wide text-text-muted"
          style={{ left: 14, top: data.relGridY + ri * (data.cell + data.gap) + data.cell / 2 - 6 }}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

const nodeTypes = { bin: BinNode, zone: ZoneNode };

/* ─────────────────────────── layout → nodes ───────────────────────────── */

function toFlowNodes(density: Density): AppNode[] {
  const { bins, zones } = buildLayout(density);
  const zoneNodes: ZoneNodeT[] = zones.map((z, i) => ({
    id: `zone-${i}`,
    type: 'zone',
    position: { x: z.x, y: z.y },
    data: {
      name: z.name,
      letter: z.letter,
      colLabels: z.colLabels,
      rowLabels: z.rowLabels,
      cell: z.cell,
      gap: z.gap,
      relGridX: z.gridX - z.x,
      relGridY: z.gridY - z.y,
    },
    style: { width: z.w, height: z.h },
    draggable: false,
    selectable: false,
    deletable: false,
    zIndex: 0,
  }));
  const binNodes: BinNodeT[] = bins.map((b) => ({
    id: b.id,
    type: 'bin',
    position: { x: b.x, y: b.y },
    data: { label: b.label, sku: b.sku, fillPct: b.fillPct },
    style: { width: b.w, height: b.h },
    zIndex: 1,
  }));
  return [...zoneNodes, ...binNodes];
}

/* ───────────────────────────── inner board ────────────────────────────── */

function FlowInner({ density, dark }: { density: Density; dark: boolean }) {
  const initial = useMemo(() => toFlowNodes(density), [density]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initial);
  const [mode, setMode] = useState<ViewMode>('fill');
  const [traceOn, setTraceOn] = useState(false);
  const { fitView } = useReactFlow();

  // Density changes the cell size → rebuild the grid.
  useEffect(() => {
    setNodes(initial);
  }, [initial, setNodes]);

  const selected = nodes.find((n) => n.selected && n.type === 'bin') as BinNodeT | undefined;

  // Trace network: bins sharing the selected bin's SKU, plus the edges to draw.
  const { tracedIds, edges } = useMemo(() => {
    const ids = new Set<string>();
    const list: Edge[] = [];
    if (!traceOn || !selected) return { tracedIds: ids, edges: list };
    const sku = selected.data.sku;
    for (const n of nodes) {
      if (n.type !== 'bin' || n.data.sku !== sku) continue;
      ids.add(n.id);
      if (n.id !== selected.id) {
        list.push({
          id: `trace-${selected.id}-${n.id}`,
          source: selected.id,
          target: n.id,
          animated: true,
          style: { stroke: ACCENT, strokeWidth: 2, strokeDasharray: '6 4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: ACCENT },
        });
      }
    }
    return { tracedIds: ids, edges: list };
  }, [traceOn, selected, nodes]);

  // Inject the live view-mode + trace highlight without disturbing positions.
  const displayNodes = useMemo<AppNode[]>(
    () =>
      nodes.map((n) =>
        n.type === 'bin' ? { ...n, data: { ...n.data, mode, traced: tracedIds.has(n.id) } } : n,
      ),
    [nodes, mode, tracedIds],
  );

  const reset = () => {
    setNodes(initial);
    window.requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
  };

  return (
    <div className="w-full">
      {/* toolbar — mirrors the konva version */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-canvas p-0.5 ring-1 ring-border-soft">
          {(['fill', 'qty'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                mode === m ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-default'
              }`}
            >
              {m === 'fill' ? 'Fill %' : 'Qty'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setTraceOn((v) => !v)}
          aria-pressed={traceOn}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
            traceOn ? 'bg-blue-500/[0.12] text-blue-600 ring-blue-500/25' : 'bg-surface-card text-text-muted ring-border-soft hover:text-text-default'
          }`}
        >
          {traceOn ? 'Trace · on' : 'Trace'}
        </button>

        <button
          onClick={reset}
          className="rounded-lg bg-surface-card px-2.5 py-1 text-[11px] font-semibold text-text-muted ring-1 ring-border-soft transition-colors hover:text-text-default"
        >
          Reset
        </button>

        <span className="ml-auto text-[11px] text-text-muted">
          {selected
            ? traceOn
              ? `${selected.data.sku} · ${tracedIds.size} bin${tracedIds.size === 1 ? '' : 's'}`
              : `${selected.data.label} · ${selected.data.sku}`
            : 'Drag a bin · select to resize · scroll to zoom'}
        </span>
      </div>

      {/* canvas */}
      <div className="h-[520px] w-full overflow-hidden rounded-xl ring-1 ring-border-soft">
        <ReactFlow<AppNode>
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          colorMode={dark ? 'dark' : 'light'}
          fitView
          minZoom={0.4}
          maxZoom={2.4}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} />
        </ReactFlow>
      </div>

      {/* legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {FILL_LEGEND.map((i) => (
          <span key={i.l} className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-3 w-3 rounded" style={{ background: i.c }} />
            {i.l}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────── theme detection (for React Flow's own chrome) ───────────── */

function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(!!document.querySelector('[data-theme="dark"]'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/* ──────────────────────────────── section ─────────────────────────────── */

export function WarehouseFlowSection({ density }: { density: Density }) {
  const dark = useDarkMode();
  return (
    <div className="flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">Interactive warehouse map · React Flow</h3>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">
            @/components/warehouse/WarehouseFlowMap · @xyflow/react
          </code>
        </div>
        <span className="inline-flex items-center rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 ring-1 ring-violet-500/20">
          2026 · Compare
        </span>
      </div>
      <div className="rounded-xl bg-surface-canvas/60 p-4 ring-1 ring-border-soft/60">
        <ReactFlowProvider>
          <FlowInner density={density} dark={dark} />
        </ReactFlowProvider>
      </div>
      <p className="mt-2.5 text-[11px] leading-snug text-text-muted">
        The same bins on <span className="font-semibold text-text-default">React Flow</span> instead of konva. Nodes are
        real DOM (so they style off design tokens and theme for free), Trace draws actual graph{' '}
        <span className="font-semibold text-text-default">edges</span> between same-SKU bins, and you get Controls + a
        MiniMap out of the box. Compare against the konva canvas above — konva wins on raw shape count &amp; pixel
        control; React Flow wins on edges/tracing, built-in chrome, and DOM theming.
      </p>
    </div>
  );
}
