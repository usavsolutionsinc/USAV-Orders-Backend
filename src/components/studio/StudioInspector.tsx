'use client';

/**
 * StudioInspector — the right pane. Context-sensitive (ST1, read-only):
 * with no focus it summarizes the loaded definition; with a focused node it
 * shows the node's identity, station binding, numbered lifecycle states
 * (workflow-stages SoT), output ports with their wired targets, and the
 * owner-facing config knobs. Station-mode editing (L2) lands at ST5.
 */

import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { workflowStage } from '@/lib/receiving/workflow-stages';
import { staffInitials } from './canvas/studio-canvas-shared';
import { StudioRecoveryPanel } from './StudioRecoveryPanel';
import { NodeConfigForm } from './NodeConfigForm';
import { DecisionRulesEditor, DecisionRulesReadout } from './DecisionRulesEditor';
import {
  circledNumber,
  formatDuration,
  oldestAgeHours,
  type Diagnostic,
  type PeopleNodeCoverage,
  type StudioDefinition,
  type StudioFlowResponse,
  type StudioGraphEdge,
  type StudioGraphNode,
  type StudioLens,
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
  /** The active lens — drives the Flow² bottleneck section. */
  lens?: StudioLens;
  /** Flow²-lens throughput metrics (null when the lens is off). */
  flow?: StudioFlowResponse | null;
  /** People-lens staffing coverage for the focused node (null when the lens is off). */
  people?: PeopleNodeCoverage | null;
  /** Lint findings for the focused node. */
  diagnostics?: Diagnostic[];
  /** Draft edit mode: the config sheet becomes editable, node becomes deletable. */
  editable?: boolean;
  /** The focused node type's configSchema (from the palette) — drives the editable config sheet. */
  configSchema?: Record<string, unknown> | null;
  onUpdateConfig?: (nodeId: string, patch: Record<string, unknown>) => void;
  onDeleteNode?: (nodeId: string) => void;
  /** Click-to-focus a node (e.g. from the bottleneck list). */
  onFocus?: (nodeId: string) => void;
}

export function StudioInspector({
  definition,
  node,
  nodes,
  edges,
  nodeCount,
  edgeCount,
  live,
  lens,
  flow,
  people,
  diagnostics,
  editable = false,
  configSchema,
  onUpdateConfig,
  onDeleteNode,
  onFocus,
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
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-micro font-semibold text-slate-600">
              v{definition.version}
            </span>
            {definition.isActive && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-micro font-semibold text-emerald-700">
                Active
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {nodeCount} nodes · {edgeCount} edges
          </p>
        </section>
        {lens === 'flow' && flow && (
          <BottlenecksSection flow={flow} nodes={nodes} onFocus={onFocus} />
        )}
        <StudioRecoveryPanel definitionId={definition.id} />
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
  // A decision node's real ports live in config.outputs (per-instance), not the
  // static registry meta — reflect those so the Ports list + read-only dump
  // match what the canvas draws and the editor edits.
  const isDecision = node.type === 'decision';
  const outputPorts: Array<{ id: string; label: string }> = isDecision
    ? (Array.isArray(node.config.outputs) ? node.config.outputs : [])
        .map((o) => {
          const row = (o ?? {}) as Record<string, unknown>;
          const id = String(row.id ?? '');
          return { id, label: String(row.label ?? '') || id };
        })
        .filter((o) => o.id)
    : node.meta?.outputs ?? [];
  const decisionConfigKeys = isDecision ? ['outputs', 'rules', 'defaultPort'] : [];
  const configEntries = Object.entries(node.config).filter(
    ([k]) => k !== 'states' && k !== 'station' && !decisionConfigKeys.includes(k),
  );

  return (
    <div className="space-y-4 p-4">
      <section>
        <PaneHeading text="Node" />
        <p className="text-sm font-bold text-slate-900">{node.meta?.label ?? node.type}</p>
        <p className="font-mono text-caption text-slate-400">{node.type}</p>
        {node.meta && (
          <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-slate-500">
            {node.meta.category}
          </span>
        )}
      </section>

      {live && (
        <section>
          <PaneHeading text="In flight now" />
          <p className="text-sm font-bold text-blue-700">{live.total}</p>
          <p className="text-caption text-slate-500">
            {live.active} active · {live.blocked} parked
            {live.error > 0 && <span className="font-semibold text-rose-600"> · {live.error} in error</span>}
          </p>
          {(() => {
            const age = oldestAgeHours(live);
            if (age == null) return null;
            const display = age >= 48 ? `${Math.round(age / 24)}d` : `${Math.round(age)}h`;
            return <p className="text-caption text-slate-400">oldest here for {display}</p>;
          })()}
        </section>
      )}

      {lens === 'flow' && flow?.nodes[node.id] && (
        <FlowMetricsSection metrics={flow.nodes[node.id]} windowDays={flow.windowDays} />
      )}

      {lens === 'people' && people && <CoverageSection people={people} />}

      {editable && onUpdateConfig ? (
        node.type === 'decision' ? (
          <section>
            <PaneHeading text="Decision rules" />
            {/* Custom rule-table editor (Track 1, Stage 1): the generic scalar
                NodeConfigForm can't express an array of when/then rows, so a
                decision node gets this editor. It writes back through the SAME
                onUpdateConfig seam, so the draft dirties + persists identically. */}
            <DecisionRulesEditor nodeId={node.id} config={node.config} onChange={onUpdateConfig} />
          </section>
        ) : (
          <section>
            <PaneHeading text="Configuration" />
            {/* Generic, schema-driven config sheet (C.1): renders one input per
                field in the node type's configSchema. The station field sources its
                options from the STATIONS registry (not a static enum) and shows the
                bound station's blurb as a field hint, preserving the prior behavior. */}
            <NodeConfigForm
              nodeId={node.id}
              schema={configSchema}
              config={node.config}
              onChange={onUpdateConfig}
              optionsFor={(fieldKey) =>
                fieldKey === 'station'
                  ? STATIONS.map((s) => ({ value: s.key, label: s.label }))
                  : null
              }
              renderFieldHint={(fieldKey, value) => {
                if (fieldKey !== 'station') return null;
                const s = STATIONS.find((x) => x.key === String(value ?? ''));
                return s ? <p className="text-caption text-slate-500">{s.blurb}</p> : null;
              }}
            />
          </section>
        )
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
            <p className="mt-1 text-caption text-slate-500">{station.blurb}</p>
          </section>
        )
      )}

      {/* Read-only rule table (published view): the editable DecisionRulesEditor
          above owns draft mode; here we render the same table as a compact list
          so the published routing logic is legible without entering a draft. */}
      {!editable && isDecision && (
        <section>
          <PaneHeading text="Decision rules" />
          <DecisionRulesReadout config={node.config} />
        </section>
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
                  <span className="truncate text-micro text-slate-400">{stage.description}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <PaneHeading text="Ports" />
        {outputPorts.length === 0 ? (
          <p className="text-xs text-slate-400">No declared output ports.</p>
        ) : (
          <ul className="space-y-1">
            {outputPorts.map((port) => {
              const wired = outgoing.find((e) => e.sourcePort === port.id);
              return (
                <li key={port.id} className="flex items-center gap-1.5 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-micro font-semibold text-slate-600">
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
          <p className="mt-1.5 text-caption text-slate-400">
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
                <li key={d.id} className="text-caption leading-tight">
                  <span className={d.severity === 'error' ? 'font-bold text-rose-600' : 'font-bold text-amber-600'}>
                    {d.severity === 'error' ? '✖' : '⚠'}
                  </span>{' '}
                  <span className="text-slate-600">{d.message}</span>
                  {d.fix && <span className="mt-0.5 block text-micro text-slate-400">↳ {d.fix}</span>}
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Read-only config dump (view mode only — in draft mode the editable
          schema-driven NodeConfigForm above owns every config field). */}
      {!editable && configEntries.length > 0 && (
        <section>
          <PaneHeading text="Config" />
          <dl className="space-y-1">
            {configEntries.map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="font-mono text-caption text-slate-500">{key}</dt>
                <dd className="truncate font-semibold text-slate-700">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {editable && onDeleteNode ? (
        <div className="border-t border-slate-100 pt-3">
          <Button variant="danger" size="sm" className="w-full" onClick={() => onDeleteNode(node.id)}>
            Delete node (and its edges)
          </Button>
        </div>
      ) : (
        <p className="border-t border-slate-100 pt-3 text-caption text-slate-400">
          Read-only — edit on a draft, then publish.
        </p>
      )}
    </div>
  );
}

function PaneHeading({ text }: { text: string }) {
  return <h3 className="mb-1.5 text-micro font-bold uppercase tracking-wider text-slate-400">{text}</h3>;
}

function PaneHint({ text }: { text: string }) {
  return <p className="p-4 text-xs text-slate-400">{text}</p>;
}

/** Flow² lens: ranked bottlenecks, each click-to-focus its node. */
function BottlenecksSection({
  flow,
  nodes,
  onFocus,
}: {
  flow: StudioFlowResponse;
  nodes: StudioGraphNode[];
  onFocus?: (nodeId: string) => void;
}) {
  const labelOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n?.meta?.label ?? n?.type ?? id;
  };
  return (
    <section>
      <PaneHeading text="Bottlenecks" />
      {flow.bottlenecks.length === 0 ? (
        <p className="text-xs text-slate-400">
          No bottlenecks over the last {flow.windowDays}d — traffic is flowing cleanly.
        </p>
      ) : (
        <ol className="space-y-1">
          {flow.bottlenecks.map((b, i) => (
            <li key={b.nodeId}>
              {/* ds-raw-button: master-detail list row (numbered badge + multi-line body), not a standard action button */}
              <button
                type="button"
                onClick={() => onFocus?.(b.nodeId)}
                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-slate-50"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-micro font-bold text-rose-700">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-800">{labelOf(b.nodeId)}</span>
                  <span className="block text-caption text-slate-500">{b.reason}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * People lens: the staff scoped to this node's station. READ-ONLY — each row is
 * a deep-LINK to the staff editor (Studio law #7); the lens never writes grants.
 * The staff editor lives at /admin?section=staff_schedule&staffId=<id>.
 */
function CoverageSection({ people }: { people: PeopleNodeCoverage }) {
  return (
    <section>
      <PaneHeading text="Coverage" />
      {people.station == null ? (
        <p className="text-xs text-slate-400">
          This step has no staffable station — no one is scoped to it.
        </p>
      ) : people.coverage === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2.5 text-center">
          <p className="text-xs font-semibold text-amber-700">No staff scoped to {people.station}</p>
          <p className="mt-0.5 text-caption text-amber-600">This step is a coverage gap.</p>
          <a
            href="/admin?section=staff_schedule"
            className="mt-1.5 inline-block text-caption font-semibold text-violet-700 underline-offset-2 hover:underline"
          >
            Assign staff in the editor →
          </a>
        </div>
      ) : (
        <>
          <p className="mb-1.5 text-caption text-slate-500">
            {people.coverage} staffer{people.coverage === 1 ? '' : 's'} scoped to{' '}
            <span className="font-semibold text-slate-600">{people.station}</span>
          </p>
          <ul className="space-y-1">
            {people.staff.map((s) => (
              <li key={s.id}>
                <HoverTooltip label="Open in the staff editor" asChild>
                  <a
                    href={`/admin?section=staff_schedule&staffId=${s.id}`}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-50"
                  >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-eyebrow font-bold text-violet-700">
                    {staffInitials(s.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">{s.name}</span>
                    {s.role && (
                      <span className="block truncate text-micro text-slate-400">{s.role}</span>
                    )}
                  </span>
                  {s.isPrimary && (
                    <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-200">
                      Primary
                    </span>
                  )}
                  </a>
                </HoverTooltip>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-micro text-slate-400">
            Read-only — staff↔station access is managed in the staff editor.
          </p>
        </>
      )}
    </section>
  );
}

/** Flow² lens: the focused node's dwell / WIP / port distribution / fail rate. */
function FlowMetricsSection({
  metrics,
  windowDays,
}: {
  metrics: NonNullable<StudioFlowResponse['nodes'][string]>;
  windowDays: number;
}) {
  const ports = Object.entries(metrics.ports).sort((a, b) => b[1] - a[1]);
  return (
    <section>
      <PaneHeading text={`Throughput · last ${windowDays}d`} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">In queue</p>
          <p className="font-bold text-slate-800 tabular-nums">{metrics.currentWip}</p>
        </div>
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">Runs</p>
          <p className="font-bold text-slate-800 tabular-nums">{metrics.runCount}</p>
        </div>
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">Median dwell</p>
          <p className="font-bold text-slate-800 tabular-nums">
            {metrics.dwellMedianS != null ? formatDuration(metrics.dwellMedianS) : '—'}
          </p>
        </div>
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">p90 dwell</p>
          <p className="font-bold text-slate-800 tabular-nums">
            {metrics.dwellP90S != null ? formatDuration(metrics.dwellP90S) : '—'}
          </p>
        </div>
      </div>
      {metrics.failRate != null && metrics.failRate > 0 && (
        <p className="mt-1.5 text-caption font-semibold text-rose-600">
          {Math.round(metrics.failRate * 100)}% of runs took a fail/error port
        </p>
      )}
      {ports.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-slate-400">Port split</p>
          <ul className="space-y-1">
            {ports.map(([port, n]) => (
              <li key={port} className="flex items-center gap-1.5 text-xs">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-micro font-semibold text-slate-600">
                  {port}
                </span>
                <span className="tabular-nums text-slate-500">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
