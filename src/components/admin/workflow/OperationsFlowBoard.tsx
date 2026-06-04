'use client';

/**
 * OperationsFlowBoard — the "how does information actually move" audit canvas.
 *
 * Renders a React Flow graph derived from REAL data (GET /api/workflow/flow-audit):
 *   - nodes  = lifecycle states, sized/labeled by live occupancy (serial_units)
 *   - edges  = observed transitions (inventory_events prev→next), thickness and
 *              label by volume in the selected window.
 *
 * This is a read-only audit view — it does not drive the workflow engine. It
 * exists so the real operation can be SEEN and improved (fat edges = hot paths,
 * backward edges = rework, a big UNKNOWN node = a data-hygiene gap). It is the
 * Phase-1 "visualize your real floor flow" board from the architecture doc, and
 * the seat the editable engine canvas grows into later.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { highlightStatesFor, findCatalogItem } from './operations-catalog';

interface FlowNode { status: string; count: number }
interface FlowEdge { from: string; to: string; count: number; lastAt: string | null }
interface EventVolume { eventType: string; count: number }
type FlowAuditResponse =
  | {
      ok: true;
      generatedAt: string;
      windowDays: number;
      nodes: FlowNode[];
      edges: FlowEdge[];
      eventVolume: EventVolume[];
      totals: { units: number; transitions: number };
    }
  | { ok: false; error: string };

type Tone =
  | 'slate' | 'sky' | 'blue' | 'amber' | 'green' | 'violet'
  | 'indigo' | 'emerald' | 'red' | 'orange' | 'rose';

const TONE: Record<Tone, { bg: string; border: string; text: string }> = {
  slate:   { bg: '#f1f5f9', border: '#94a3b8', text: '#334155' },
  sky:     { bg: '#e0f2fe', border: '#38bdf8', text: '#075985' },
  blue:    { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  amber:   { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  green:   { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
  violet:  { bg: '#ede9fe', border: '#8b5cf6', text: '#5b21b6' },
  indigo:  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3' },
  emerald: { bg: '#d1fae5', border: '#10b981', text: '#065f46' },
  red:     { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
  orange:  { bg: '#ffedd5', border: '#f97316', text: '#9a3412' },
  rose:    { bg: '#ffe4e6', border: '#f43f5e', text: '#9f1239' },
};

// Hand-tuned lifecycle layout: a primary left→right happy path, exceptions and
// branches dropped into rows below. Statuses not in this map are auto-stacked in
// an "unmapped" column so nothing is ever silently dropped.
const LAYOUT: Record<string, { x: number; y: number; tone: Tone }> = {
  UNKNOWN:     { x: 0,    y: 0,   tone: 'slate' },
  EXPECTED:    { x: 0,    y: 160, tone: 'slate' },
  ARRIVED:     { x: 210,  y: 160, tone: 'sky' },
  MATCHED:     { x: 420,  y: 160, tone: 'sky' },
  UNBOXED:     { x: 630,  y: 160, tone: 'sky' },
  RECEIVED:    { x: 840,  y: 160, tone: 'blue' },
  IN_TEST:     { x: 1050, y: 60,  tone: 'amber' },
  TRIAGED:     { x: 1050, y: 260, tone: 'amber' },
  GRADED:      { x: 1260, y: 40,  tone: 'green' },
  TESTED:      { x: 1260, y: 160, tone: 'green' },
  ON_HOLD:     { x: 1260, y: 300, tone: 'red' },
  FAILED:      { x: 1260, y: 400, tone: 'red' },
  IN_REPAIR:   { x: 1470, y: 340, tone: 'orange' },
  REPAIR_DONE: { x: 1680, y: 340, tone: 'orange' },
  STOCKED:     { x: 1470, y: 160, tone: 'violet' },
  ALLOCATED:   { x: 1680, y: 160, tone: 'violet' },
  PICKED:      { x: 1890, y: 160, tone: 'indigo' },
  PACKED:      { x: 2100, y: 160, tone: 'indigo' },
  LABELED:     { x: 2310, y: 160, tone: 'indigo' },
  SHIPPED:     { x: 2520, y: 160, tone: 'emerald' },
  DONE:        { x: 2730, y: 160, tone: 'emerald' },
  RETURNED:    { x: 2520, y: 360, tone: 'rose' },
  RMA:         { x: 2730, y: 360, tone: 'rose' },
  RTV:         { x: 1470, y: 460, tone: 'red' },
  SCRAP:       { x: 1680, y: 460, tone: 'red' },
  SCRAPPED:    { x: 1680, y: 540, tone: 'red' },
};

const WINDOWS = [30, 90, 365] as const;

function buildGraph(
  data: Extract<FlowAuditResponse, { ok: true }>,
  highlight: Set<string> | null,
): {
  nodes: Node[];
  edges: Edge[];
} {
  const occupancy = new Map(data.nodes.map((n) => [n.status, n.count]));

  // Union of every status that appears as a node or an edge endpoint.
  const statuses = new Set<string>(data.nodes.map((n) => n.status));
  for (const e of data.edges) {
    statuses.add(e.from);
    statuses.add(e.to);
  }

  let unmappedRow = 0;
  const nodes: Node[] = [...statuses].map((status) => {
    const pos = LAYOUT[status] ?? { x: -260, y: unmappedRow++ * 90, tone: 'slate' as Tone };
    const tone = TONE[pos.tone];
    const count = occupancy.get(status) ?? 0;
    const spotlit = !highlight || highlight.has(status);
    return {
      id: status,
      position: { x: pos.x, y: pos.y },
      data: {
        label: (
          <div style={{ textAlign: 'center', lineHeight: 1.15 }}>
            <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 0.2 }}>{status}</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{count}</div>
          </div>
        ),
      },
      style: {
        background: tone.bg,
        border: `2px solid ${tone.border}`,
        color: tone.text,
        borderRadius: 12,
        width: 132,
        padding: '8px 6px',
        opacity: spotlit ? 1 : 0.22,
        boxShadow: spotlit && highlight ? `0 0 0 3px ${tone.border}44` : '0 1px 2px rgba(15,23,42,0.06)',
      },
    };
  });

  const maxCount = data.edges.reduce((m, e) => Math.max(m, e.count), 1);
  const edges: Edge[] = data.edges.map((e) => {
    // Thickness scales with volume; thin edges still visible.
    const width = 1 + Math.round((e.count / maxCount) * 6);
    const hot = e.count / maxCount > 0.5;
    const onPath = !highlight || (highlight.has(e.from) && highlight.has(e.to));
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      label: String(e.count),
      animated: hot && onPath,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
      style: { stroke: hot ? '#475569' : '#94a3b8', strokeWidth: width, opacity: onPath ? 0.85 : 0.12 },
      labelStyle: { fontSize: 11, fontWeight: 700, fill: '#334155' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    };
  });

  return { nodes, edges };
}

export function OperationsFlowBoard() {
  const searchParams = useSearchParams();
  const selectedOps = searchParams.get('ops');
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<FlowAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (windowDays: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workflow/flow-audit?days=${windowDays}`, { cache: 'no-store' });
      setData((await res.json()) as FlowAuditResponse);
    } catch (err) {
      setData({ ok: false, error: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const highlight = useMemo(() => highlightStatesFor(selectedOps), [selectedOps]);
  const spotlight = useMemo(() => findCatalogItem(selectedOps), [selectedOps]);
  const graph = useMemo(
    () => (data?.ok ? buildGraph(data, highlight) : { nodes: [], edges: [] }),
    [data, highlight],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <style>{`@keyframes gridDrift { from { transform: translate(0,0);} to { transform: translate(96px,96px);} }`}</style>

      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-slate-900">
            Operations · Item flow
            {spotlight ? (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                Spotlight: {spotlight.item.label}
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-slate-500">
            How units actually move through the system, from real lifecycle events.
            {data?.ok ? (
              <span className="ml-1 font-medium text-slate-700">
                {data.totals.units.toLocaleString()} units · {data.totals.transitions.toLocaleString()} transitions ({days}d)
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                days === w
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {w}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(days)}
            className="ml-1 rounded-md border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-x-0 top-0 z-10 bg-blue-50 px-5 py-1 text-center text-xs font-medium text-blue-700">
            Loading flow…
          </div>
        )}
        {data && !data.ok && (
          <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-semibold">Couldn’t load the flow.</p>
            <p className="mt-1 text-xs">{data.error}</p>
          </div>
        )}
        {data?.ok && (
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            fitView
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#cbd5e1" style={{ opacity: 0.5 }} />
            <Background
              id="drift"
              variant={BackgroundVariant.Lines}
              gap={96}
              color="#e2e8f0"
              style={{ opacity: 0.5, animation: 'gridDrift 40s linear infinite' }}
            />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (n.style?.borderColor as string) ?? '#94a3b8'} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
