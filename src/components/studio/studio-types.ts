/**
 * Shared types for the Operations Studio client (mirrors the
 * GET /api/studio/graph response shape).
 */

import type { Diagnostic } from '@/lib/workflow/diagnostics';

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
  palette: Array<StudioNodeMeta & { type: string; configSchema?: Record<string, unknown> }>;
  diagnostics: Diagnostic[];
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
}

export interface StudioStationResponse {
  ok: boolean;
  station: StudioStationView | null;
  error?: string;
}

/** Lenses live so far — Build (ST1), Static + Live (ST2), Gaps (ST3). Flow²/People later. */
export type StudioLens = 'build' | 'static' | 'live' | 'gaps';

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
