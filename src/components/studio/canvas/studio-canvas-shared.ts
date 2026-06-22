import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import type { FlowRole } from '@/lib/studio/static-flow-graph';
import type { HeatLevel } from '@/lib/studio/live-heat';
import type {
  Annotation,
  Diagnostic,
  FlowNodeMetrics,
  PeopleNodeCoverage,
  StudioFlowResponse,
  StudioGraphEdge,
  StudioGraphNode,
  StudioLens,
  StudioLiveNode,
  StudioZoom,
} from '../studio-types';

export const REWORK_PORTS = new Set(['fail', 'repaired']);

/** Static-lens role styling — accent border + header pill per data-flow role. */
export const STATIC_ROLE: Record<FlowRole, { label: string; color: string; pill: string }> = {
  source: { label: 'Source', color: '#0284c7', pill: 'bg-sky-50 text-sky-700' },
  transform: { label: 'Transform', color: '#64748b', pill: 'bg-slate-100 text-slate-600' },
  sink: { label: 'Sink', color: '#059669', pill: 'bg-emerald-50 text-emerald-700' },
};

/** Live-lens heat → card tone (border + ring + wash), count badge, text & dot tints. */
export const HEAT_TONE: Record<HeatLevel, string> = {
  idle: 'border-slate-200 bg-white',
  active: 'border-slate-200 bg-white',
  warm: 'border-amber-400 ring-2 ring-amber-200 bg-amber-50',
  hot: 'border-rose-400 ring-2 ring-rose-200 bg-rose-50',
};
export const HEAT_BADGE: Record<HeatLevel, string> = {
  idle: 'bg-blue-600',
  active: 'bg-blue-600',
  warm: 'bg-amber-500',
  hot: 'bg-rose-600',
};
export const HEAT_ACCENT: Record<HeatLevel, string> = {
  idle: 'text-blue-600',
  active: 'text-blue-600',
  warm: 'text-amber-600',
  hot: 'text-rose-600',
};
export const HEAT_DOT: Record<HeatLevel, string> = {
  idle: 'bg-blue-500',
  active: 'bg-blue-500',
  warm: 'bg-amber-500',
  hot: 'bg-rose-500',
};

/** Up-to-2-char initials for a staffer's name (avatar fallback). */
export function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Compact age label: 45m · 4h · 3d. */
export function formatAgeHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export function stationOf(node: StudioGraphNode) {
  const key = String(node.config.station ?? '');
  return STATIONS.find((s) => s.key === key) ?? null;
}

export interface CanvasProps {
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
  zoom: StudioZoom;
  lens: StudioLens;
  /** Per-node occupancy when the Live lens is on; null otherwise. */
  live: Record<string, StudioLiveNode> | null;
  /**
   * Recently-traversed edges, keyed `${sourceNode} ${sourcePort}` — the
   * Live lens pulses these for ~1.5s as units advance (engine WorkflowEvent
   * stream over Ably). Empty when the lens is off or nothing fired lately.
   */
  flowEdges?: ReadonlySet<string>;
  /** Throughput/trend metrics when the Flow² lens is on; null otherwise. */
  flow?: StudioFlowResponse | null;
  /** Per-node staffing coverage when the People lens is on; null otherwise. */
  people?: Record<string, PeopleNodeCoverage> | null;
  /** Graph lint results — painted as node markers by the Gaps lens. */
  diagnostics: Diagnostic[];
  focus: string | null;
  /** Draft edit mode (ST4): drag, connect, remove. */
  editable?: boolean;
  /** Receives the full updated node/edge arrays on every edit. */
  onGraphChange?: (patch: { nodes?: StudioGraphNode[]; edges?: StudioGraphEdge[] }) => void;
  // ─── Canvas sticky-note annotations (Phase E3) — a decoration layer, never engine nodes ───
  /** Sticky-notes to paint on the canvas (working copy while editing, else published). */
  annotations?: Annotation[];
  /** Edit-mode sticky-note mutations (no-ops / absent on read-only views). */
  onMoveAnnotation?: (id: string, x: number, y: number) => void;
  onUpdateAnnotationText?: (id: string, text: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  onFocus: (id: string | null) => void;
  onZoomTo: (depth: StudioZoom) => void;
  /** Drill from a process node (L1) into its station detail (L2). */
  onOpenStation?: (nodeId: string) => void;
  // ─── Simulate overlay (ST6) — a client-side ghost-run; never a lens, never a write ───
  /** Node the simulation ghost currently occupies (null when no run is active). */
  simGhostNodeId?: string | null;
  /** Edge ids the ghost has traversed — tinted to show the path walked. */
  simTraversedEdgeIds?: ReadonlySet<string>;
}

export type ProcessNodeData = {
  node: StudioGraphNode;
  dimmed: boolean;
  focused: boolean;
  /** Live-lens occupancy for this node (null when the lens is off or empty). */
  live: StudioLiveNode | null;
  /** Gaps-lens markers for this node (empty when the lens is off or clean). */
  gaps: Diagnostic[];
  /** Static-lens role (source/transform/sink), or null when the lens is off. */
  staticRole: FlowRole | null;
  /** Static-lens unwired output ports — data branches that go nowhere. */
  staticDangling: string[];
  /** Flow²-lens per-node throughput metrics (null when the lens is off). */
  flow: FlowNodeMetrics | null;
  /** True when this node is in the Flow² lens's ranked bottleneck list. */
  flowBottleneck: boolean;
  /** People-lens staffing coverage for this node (null when the lens is off). */
  people: PeopleNodeCoverage | null;
  /** Simulate overlay: the ghost-run dot is currently sitting on this node. */
  simGhost: boolean;
};

export type DepartmentNodeData = {
  label: string;
  color: string;
  stepCount: number;
  stepLabels: string[];
  /** Summed in-flight count across member nodes (Live lens only). */
  inFlight: number | null;
};

/** Sticky-note annotation node data (Phase E3) — a canvas decoration, not an engine node. */
export type AnnotationNodeData = {
  annotation: Annotation;
  /** Edit mode → inline-editable + deletable; read-only otherwise. */
  editable: boolean;
  onUpdateText?: (id: string, text: string) => void;
  onDelete?: (id: string) => void;
};
