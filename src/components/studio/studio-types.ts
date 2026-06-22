/**
 * Shared types for the Operations Studio client (mirrors the
 * GET /api/studio/graph response shape).
 */

import type { Diagnostic } from '@/lib/workflow/diagnostics';
import type { StationConfig } from '@/lib/stations/contract';

export type { Diagnostic };

export interface StudioNodeMeta {
  label: string;
  icon: string;
  category: 'intake' | 'process' | 'fulfill' | 'logic' | 'custom';
  outputs: Array<{ id: string; label: string }>;
}

export interface StudioGraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  meta: StudioNodeMeta | null;
}

export interface StudioGraphEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
}

/**
 * A canvas sticky-note annotation (Studio ST6 / Phase E3) — a free-text
 * decoration on the React Flow surface. NOT an engine node: annotations have no
 * type/ports, are never lintable by diagnostics, and never participate in
 * routing or simulate. They ride WITH the definition row (persisted in
 * workflow_definitions.annotations) and are editable only on a draft.
 */
export interface Annotation {
  id: string;
  text: string;
  x: number;
  y: number;
  /** Optional sticky tone key (defaults to amber on the canvas). */
  color?: string;
}

export interface StudioDefinition {
  id: number;
  name: string;
  version: number;
  isActive: boolean;
}

export interface StudioGraphResponse {
  ok: boolean;
  definitions: StudioDefinition[];
  definition: StudioDefinition | null;
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
  /** Canvas sticky-note decorations (Phase E3) — ride with the definition, not engine nodes. */
  annotations: Annotation[];
  palette: Array<StudioNodeMeta & { type: string; configSchema?: Record<string, unknown> }>;
  diagnostics: Diagnostic[];
  error?: string;
}

// ─── Template library (ST6 / Phase E4) — the /api/studio/templates feed ──────
// System-owned DEFAULT workflow graphs a tenant clones into its own definitions
// (import = re-mint ids + org-stamp into a new is_active=false draft). The rows
// are GLOBAL (no org), so the list is identical for every org.

export interface StudioTemplateSummary {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  nodeCount: number;
  edgeCount: number;
}

/** Full template graph (mirrors the /api/studio/graph node/edge shape). */
export interface StudioTemplateDetail {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
}

export interface StudioTemplatesResponse {
  ok: boolean;
  templates: StudioTemplateSummary[];
  error?: string;
}

/**
 * Zoom depths: L0 business map · L1 flow graph · L2 station detail (read-only
 * preview of a node's bound station). L3 block-binding arrives with editing.
 */
export type StudioZoom = 0 | 1 | 2;

// ─── L2 station detail (read-only) — the /api/studio/nodes/[id]/station feed ──
// Server-resolved against the stations registries, so the client renders
// labels/icons/endpoints without importing the registry.

export interface StudioStationBlockView {
  id: string;
  block: string;
  blockLabel: string;
  blockIcon: string;
  source: {
    id: string;
    label: string;
    integration: string;
    endpoint: string;
    realtimeChannel: string | null;
  } | null;
  /** role key → bound source field key. */
  fields: Record<string, string>;
  actions: Array<{ id: string; label: string; icon: string }>;
  doneWhen: string | null;
}

export interface StudioStationSlotView {
  slot: string;
  blocks: StudioStationBlockView[];
}

export interface StudioStationView {
  id: number;
  label: string;
  pageKey: string;
  modeKey: string;
  workflowNodeId: string | null;
  version: number;
  isActive: boolean;
  /** The station still renders its original hard-coded tree (not yet composed). */
  legacy: boolean;
  slots: StudioStationSlotView[];
  /** Raw composition (DATA) — the L2 editor seeds its working copy from this. */
  config: StationConfig;
}

export interface StudioStationResponse {
  ok: boolean;
  station: StudioStationView | null;
  error?: string;
}

/** Lenses live so far — Build (ST1), Static + Live + Flow² (ST2), Gaps (ST3), People (ST6). */
export type StudioLens = 'build' | 'static' | 'live' | 'gaps' | 'flow' | 'people';

// ─── People lens (the /api/studio/people feed) ───────────────────────────────
// Per-node staffing coverage assembled server-side from the node→station
// crosswalk + staff_stations. Read-only: the client links to the staff editor,
// it never writes grants (Studio law #7).
export type {
  StudioPeopleResponse,
  PeopleNodeCoverage,
} from '@/lib/studio/people-coverage';

// ─── Flow² lens (the /api/studio/flow feed) ──────────────────────────────────
// Trend/throughput metrics assembled server-side from workflow_runs +
// workflow_node_stats. Client renders heat/thickness/bottlenecks without the SQL.
export type {
  StudioFlowResponse,
  FlowNodeMetrics,
  FlowEdgeMetrics,
  FlowBottleneck,
} from '@/lib/studio/flow-metrics';
export { formatDuration } from '@/lib/studio/flow-metrics';

/** Per-node in-flight occupancy (the /api/studio/live feed). */
export interface StudioLiveNode {
  active: number;
  blocked: number;
  error: number;
  /** active + blocked — what's physically sitting at the step. */
  total: number;
  oldestEnteredAt: string | null;
}

export interface StudioLiveResponse {
  ok: boolean;
  nodes: Record<string, StudioLiveNode>;
  totalInFlight: number;
  error?: string;
}

/** Hours a node's oldest item has been sitting, or null when empty. */
export function oldestAgeHours(live: StudioLiveNode | undefined | null): number | null {
  if (!live?.oldestEnteredAt) return null;
  const t = Date.parse(live.oldestEnteredAt);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

/** Circled-digit rendering for workflow-stage `order` values (① ② ③ …). */
export function circledNumber(order: number): string {
  if (order === 0) return '⓪';
  if (order >= 1 && order <= 20) return String.fromCodePoint(0x2460 + order - 1);
  return String(order);
}
