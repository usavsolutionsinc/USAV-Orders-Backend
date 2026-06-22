/**
 * Flow² metrics assembly (Operations Studio ST2).
 *
 * The Live lens shows the CURRENT occupancy of each node (active/blocked now).
 * Flow² is the TREND/THROUGHPUT view: how long units dwell at each node, how
 * traffic splits across each node's output ports, how WIP has grown over the
 * snapshot window, and which nodes are the bottlenecks.
 *
 * The heavy lifting is SQL (percentile_cont for dwell, the lag() window for
 * per-unit time-in-node, GROUP BY for port distribution); this module is the
 * PURE assembler that maps those raw aggregates onto the graph's node INSTANCES
 * and ranks bottlenecks — so it is unit-testable with plain objects, no DB.
 *
 * Granularity note: workflow_runs records node_TYPE (e.g. 'list_ebay'), not the
 * node instance id, so dwell + port metrics are per-type and fan out to every
 * instance of that type; workflow_node_stats is keyed by node_id, so WIP trend
 * is per-instance. The assembler joins the two by (instance.type → type metric)
 * and (instance.id → stats).
 */

export interface FlowNodeRef {
  id: string;
  type: string;
}

export interface FlowEdgeRef {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
}

/** Per-node-TYPE dwell aggregate (from the workflow_runs lag() query). */
export interface DwellByType {
  nodeType: string;
  medianS: number | null;
  p90S: number | null;
  samples: number;
}

/** Per-(node_type, output) run count (from the GROUP BY query). */
export interface PortCount {
  nodeType: string;
  output: string;
  n: number;
}

/** One workflow_node_stats snapshot row (per node_id, per day). */
export interface WipSnapshot {
  nodeId: string;
  date: string;
  queueDepth: number;
  blocked: number;
  error: number;
}

export interface FlowNodeMetrics {
  nodeId: string;
  nodeType: string;
  /** Median time a unit dwelt at this node before advancing, in seconds. */
  dwellMedianS: number | null;
  dwellP90S: number | null;
  /** Completed dwell samples observed in the window. */
  runCount: number;
  /** Latest snapshot queue depth (active+blocked sitting here). */
  currentWip: number;
  /** output port id → times that port fired. */
  ports: Record<string, number>;
  /** fraction of runs that took a fail/error port (null when no runs). */
  failRate: number | null;
  /** Per-day WIP history for the sparkline (ascending date). */
  wipTrend: Array<{ date: string; queueDepth: number; blocked: number; error: number }>;
}

export interface FlowEdgeMetrics {
  /** units that traversed this edge in the window (source port firings). */
  volume: number;
}

export interface FlowBottleneck {
  nodeId: string;
  nodeType: string;
  /** Composite rank score (higher = more of a bottleneck). */
  score: number;
  reason: string;
  currentWip: number;
  dwellP90S: number | null;
}

export interface StudioFlowResponse {
  ok: boolean;
  windowDays: number;
  nodes: Record<string, FlowNodeMetrics>;
  edges: Record<string, FlowEdgeMetrics>;
  bottlenecks: FlowBottleneck[];
  error?: string;
}

const FAIL_PORTS = new Set(['fail', 'error']);

export interface AssembleFlowInput {
  nodes: FlowNodeRef[];
  edges: FlowEdgeRef[];
  dwellByType: DwellByType[];
  portCounts: PortCount[];
  wipSnapshots: WipSnapshot[];
  windowDays: number;
  /** How many bottlenecks to surface (default 5). */
  topBottlenecks?: number;
}

/**
 * Assemble the per-node-instance Flow² metrics + edge volumes + bottleneck
 * ranking from the raw SQL aggregates. Pure — no DB, no clock.
 */
export function assembleFlowMetrics(input: AssembleFlowInput): StudioFlowResponse {
  const dwellByType = new Map(input.dwellByType.map((d) => [d.nodeType, d]));

  // node_type → { output → count } and node_type → total runs
  const portsByType = new Map<string, Record<string, number>>();
  const totalRunsByType = new Map<string, number>();
  const failRunsByType = new Map<string, number>();
  for (const p of input.portCounts) {
    const ports = portsByType.get(p.nodeType) ?? {};
    ports[p.output] = (ports[p.output] ?? 0) + p.n;
    portsByType.set(p.nodeType, ports);
    totalRunsByType.set(p.nodeType, (totalRunsByType.get(p.nodeType) ?? 0) + p.n);
    if (FAIL_PORTS.has(p.output)) {
      failRunsByType.set(p.nodeType, (failRunsByType.get(p.nodeType) ?? 0) + p.n);
    }
  }

  // node_id → ascending-by-date WIP snapshots
  const trendByNode = new Map<string, WipSnapshot[]>();
  for (const s of input.wipSnapshots) {
    const arr = trendByNode.get(s.nodeId) ?? [];
    arr.push(s);
    trendByNode.set(s.nodeId, arr);
  }
  for (const arr of trendByNode.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  const nodes: Record<string, FlowNodeMetrics> = {};
  for (const n of input.nodes) {
    const dwell = dwellByType.get(n.type);
    const ports = portsByType.get(n.type) ?? {};
    const total = totalRunsByType.get(n.type) ?? 0;
    const fails = failRunsByType.get(n.type) ?? 0;
    const trend = (trendByNode.get(n.id) ?? []).map((s) => ({
      date: s.date,
      queueDepth: s.queueDepth,
      blocked: s.blocked,
      error: s.error,
    }));
    const currentWip = trend.length ? trend[trend.length - 1].queueDepth : 0;
    nodes[n.id] = {
      nodeId: n.id,
      nodeType: n.type,
      dwellMedianS: dwell?.medianS ?? null,
      dwellP90S: dwell?.p90S ?? null,
      runCount: dwell?.samples ?? 0,
      currentWip,
      ports,
      failRate: total > 0 ? fails / total : null,
      wipTrend: trend,
    };
  }

  // Edge volume = times the source node's port fired. workflow_runs is per-type,
  // so every edge out of a same-type node sees that type's port total (fine —
  // the seed graph has one node per type; multi-instance graphs over-attribute
  // symmetrically, documented).
  const edges: Record<string, FlowEdgeMetrics> = {};
  for (const e of input.edges) {
    const srcNode = nodes[e.source];
    const volume = srcNode ? srcNode.ports[e.sourcePort] ?? 0 : 0;
    edges[e.id] = { volume };
  }

  // Bottleneck score: WIP dominates (units stuck now), dwell p90 breaks ties
  // (slow even when not piled up). Only rank nodes with some signal.
  const bottlenecks: FlowBottleneck[] = Object.values(nodes)
    .map((m) => {
      const dwell = m.dwellP90S ?? m.dwellMedianS ?? 0;
      const score = m.currentWip * 10_000 + dwell;
      const reasons: string[] = [];
      if (m.currentWip > 0) reasons.push(`${m.currentWip} in queue`);
      if (m.dwellP90S != null) reasons.push(`p90 dwell ${formatDuration(m.dwellP90S)}`);
      if ((m.failRate ?? 0) > 0) reasons.push(`${Math.round((m.failRate ?? 0) * 100)}% fail`);
      return {
        nodeId: m.nodeId,
        nodeType: m.nodeType,
        score,
        reason: reasons.join(' · ') || 'no traffic',
        currentWip: m.currentWip,
        dwellP90S: m.dwellP90S,
      };
    })
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topBottlenecks ?? 5);

  return { ok: true, windowDays: input.windowDays, nodes, edges, bottlenecks };
}

/** Compact human duration for the bottleneck reason string (s → "2h 5m"/"3m"/"45s"). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
