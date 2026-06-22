// Single source of truth for operations "agent" (subsystem health) status tones.
//
// Nested meta (dot + chip + label) — the exemplar shape (cf. unit-status.ts).
// Single surface today: OperationsAgentsRow. Classes preserved verbatim; hues
// follow the color story (DESIGN_SYSTEM.md): online=success, offline=danger,
// unconfigured=warning, unknown=neutral. src/lib is in Tailwind content globs.
//
// `AgentStatus` mirrors the union owned by
// features/operations/components/useLocalAgents.ts (identical members →
// structurally assignable); kept local so this SoT has no feature dependency.

export type AgentStatus = 'online' | 'offline' | 'unconfigured' | 'unknown';

export interface AgentStatusMeta {
  dot: string;
  chip: string;
  label: string;
}

const META: Record<AgentStatus, AgentStatusMeta> = {
  online: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', label: 'Online' },
  offline: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', label: 'Offline' },
  unconfigured: { dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700', label: 'Not set up' },
  unknown: { dot: 'bg-gray-300', chip: 'bg-gray-100 text-gray-500', label: 'Unknown' },
};

/** Dot/chip/label meta for an agent status; falls back to `unknown`. */
export function agentStatusMeta(status: AgentStatus): AgentStatusMeta {
  return META[status] ?? META.unknown;
}
