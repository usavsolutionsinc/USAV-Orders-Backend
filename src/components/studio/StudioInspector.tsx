'use client';

/**
 * StudioInspector — the right pane. Context-sensitive (ST1, read-only):
 * with no focus it summarizes the loaded definition; with a focused node it
 * shows the node's identity, station binding, numbered lifecycle states
 * (workflow-stages SoT), output ports with their wired targets, and the
 * owner-facing config knobs. Station-mode editing (L2) lands at ST5.
 */

import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import { workflowStage } from '@/lib/receiving/workflow-stages';
import {
  circledNumber,
  oldestAgeHours,
  type Diagnostic,
  type StudioDefinition,
  type StudioGraphEdge,
  type StudioGraphNode,
  type StudioLiveNode,
} from './studio-types';

interface InspectorProps {
  definition: StudioDefinition | null;
  node: StudioGraphNode | null;
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
  nodeCount: number;
  edgeCount: number;
  /** Live-lens occupancy for the focused node (null when the lens is off). */
  live?: StudioLiveNode | null;
  /** Lint findings for the focused node. */
  diagnostics?: Diagnostic[];
  /** Draft edit mode: station/SLA become editable, node becomes deletable. */
  editable?: boolean;
  onUpdateConfig?: (nodeId: string, patch: Record<string, unknown>) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export function StudioInspector({
  definition,
  node,
  nodes,
  edges,
  nodeCount,
  edgeCount,
  live,
  diagnostics,
  editable = false,
  onUpdateConfig,
  onDeleteNode,
}: InspectorProps) {
  if (!definition) {
    return <PaneHint text="Load a workflow to inspect it." />;
  }

  if (!node) {
    return (
      <div className="space-y-4 p-4">
        <section>
          <PaneHeading text="Workflow" />
          <p className="text-sm font-bold text-slate-900">{definition.name}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              v{definition.version}
            </span>
            {definition.isActive && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                Active
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {nodeCount} nodes · {edgeCount} edges
          </p>
        </section>
        <PaneHint text="Select a node on the canvas to inspect its states, ports and config." />
      </div>
    );
  }

  const station = STATIONS.find((s) => s.key === String(node.config.station ?? ''));
  const states = Array.isArray(node.config.states) ? (node.config.states as string[]) : [];
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const labelOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n?.meta?.label ?? n?.type ?? id;
  };
  const configEntries = Object.entries(node.config).filter(([k]) => k !== 'states' && k !== 'station');

  return (
    <div className="space-y-4 p-4">
      <section>
        <PaneHeading text="Node" />
        <p className="text-sm font-bold text-slate-900">{node.meta?.label ?? node.type}</p>
        <p className="font-mono text-[11px] text-slate-400">{node.type}</p>
        {node.meta && (
          <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {node.meta.category}
          </span>
        )}
      </section>

      {live && (
        <section>
          <PaneHeading text="In flight now" />
          <p className="text-sm font-bold text-blue-700">{live.total}</p>
          <p className="text-[11px] text-slate-500">
            {live.active} active · {live.blocked} parked
            {live.error > 0 && <span className="font-semibold text-rose-600"> · {live.error} in error</span>}
          </p>
          {(() => {
            const age = oldestAgeHours(live);
            if (age == null) return null;
            const display = age >= 48 ? `${Math.round(age / 24)}d` : `${Math.round(age)}h`;
            return <p className="text-[11px] text-slate-400">oldest here for {display}</p>;
          })()}
        </section>
      )}

      {editable && onUpdateConfig ? (
        <section>
          <PaneHeading text="Station" />
          <select
            value={String(node.config.station ?? '')}
            onChange={(e) => onUpdateConfig(node.id, { station: e.target.value || null })}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
            aria-label="Bound station"
          >
            <option value="">— no station —</option>
            {STATIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {station && <p className="mt-1 text-[11px] text-slate-500">{station.blurb}</p>}

          <PaneHeading text="SLA hours" />
          <input
            type="number"
            min={0}
            value={typeof node.config.slaHours === 'number' ? node.config.slaHours : ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              onUpdateConfig(node.id, { slaHours: e.target.value === '' || !Number.isFinite(n) ? null : n });
            }}
            placeholder="none"
            className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
            aria-label="SLA hours"
          />
          <p className="mt-1 text-[11px] text-slate-400">Flag items sitting here longer than this.</p>
        </section>
      ) : (
        station && (
          <section>
            <PaneHeading text="Station" />
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold"
              style={{ background: `${station.color}18`, color: station.color }}
            >
              {station.label}
            </span>
            <p className="mt-1 text-[11px] text-slate-500">{station.blurb}</p>
          </section>
        )
      )}

      {states.length > 0 && (
        <section>
          <PaneHeading text="Lifecycle states" />
          <div className="space-y-1">
            {states.map((key) => {
              const stage = workflowStage(key);
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${stage.dot}`} />
                  <span className="font-semibold text-slate-700">
                    {circledNumber(stage.order)} {stage.label}
                  </span>
                  <span className="truncate text-[10px] text-slate-400">{stage.description}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <PaneHeading text="Ports" />
        {(node.meta?.outputs ?? []).length === 0 ? (
          <p className="text-xs text-slate-400">No declared output ports.</p>
        ) : (
          <ul className="space-y-1">
            {(node.meta?.outputs ?? []).map((port) => {
              const wired = outgoing.find((e) => e.sourcePort === port.id);
              return (
                <li key={port.id} className="flex items-center gap-1.5 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                    {port.id}
                  </span>
                  {wired ? (
                    <span className="truncate text-slate-500">→ {labelOf(wired.target)}</span>
                  ) : (
                    <span className="text-slate-400">→ terminal (run completes)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {incoming.length > 0 && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            Fed by {incoming.map((e) => `${labelOf(e.source)} (${e.sourcePort})`).join(', ')}
          </p>
        )}
      </section>

      {diagnostics && diagnostics.filter((d) => d.severity !== 'info').length > 0 && (
        <section>
          <PaneHeading text="Issues" />
          <ul className="space-y-1.5">
            {diagnostics
              .filter((d) => d.severity !== 'info')
              .map((d) => (
                <li key={d.id} className="text-[11px] leading-tight">
                  <span className={d.severity === 'error' ? 'font-bold text-rose-600' : 'font-bold text-amber-600'}>
                    {d.severity === 'error' ? '✖' : '⚠'}
                  </span>{' '}
                  <span className="text-slate-600">{d.message}</span>
                  {d.fix && <span className="mt-0.5 block text-[10px] text-slate-400">↳ {d.fix}</span>}
                </li>
              ))}
          </ul>
        </section>
      )}

      {configEntries.length > 0 && (
        <section>
          <PaneHeading text="Config" />
          <dl className="space-y-1">
            {configEntries.map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="font-mono text-[11px] text-slate-500">{key}</dt>
                <dd className="truncate font-semibold text-slate-700">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {editable && onDeleteNode ? (
        <div className="border-t border-slate-100 pt-3">
          <button
            onClick={() => onDeleteNode(node.id)}
            className="w-full rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
          >
            Delete node (and its edges)
          </button>
        </div>
      ) : (
        <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Read-only — edit on a draft, then publish.
        </p>
      )}
    </div>
  );
}

function PaneHeading({ text }: { text: string }) {
  return <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{text}</h3>;
}

function PaneHint({ text }: { text: string }) {
  return <p className="p-4 text-xs text-slate-400">{text}</p>;
}
