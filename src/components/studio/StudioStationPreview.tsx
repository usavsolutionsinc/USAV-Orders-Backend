'use client';

/**
 * StudioStationPreview — the L2 "station detail" pane (read-only).
 *
 * When a node is focused at zoom L2, this replaces the canvas with a read-only
 * view of the station bound to that node (station_definitions.workflow_node_id):
 * its slots → block instances → source bindings + actions, all resolved on the
 * server from the stations registries. Editing the composition is a later phase
 * (Studio law #6 — drafts only, publish atomically); this is observation, so it
 * ships under the gate ahead of any write path.
 */

import { icons } from 'lucide-react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { StudioGraphNode, StudioStationView } from './studio-types';

const SLOT_LABELS: Record<string, string> = {
  trigger: 'Trigger',
  queue: 'Queue',
  workspace: 'Workspace',
  advance: 'Advance',
  header: 'Header',
};

function Icon({ name, className }: { name: string | undefined; className?: string }) {
  const C = (name && (icons as Record<string, React.ComponentType<{ className?: string }>>)[name]) || icons.Box;
  return <C className={className} />;
}

export function StudioStationPreview({
  node,
  station,
  loading,
  onBack,
}: {
  node: StudioGraphNode | null;
  station: StudioStationView | null;
  loading: boolean;
  onBack: () => void;
}) {
  const nodeLabel = node?.meta?.label ?? node?.type ?? 'Step';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      {/* Sub-header: back + context */}
      <div className="flex items-center gap-3 border-b border-border-soft bg-surface-card px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          icon={<icons.ArrowLeft />}
          className="text-text-muted hover:bg-surface-sunken hover:text-text-default"
        >
          Flow
        </Button>
        <span className="text-text-faint">/</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-text-default">
            {station?.label ?? `${nodeLabel} · station`}
          </p>
          <p className="truncate text-caption text-text-faint">
            {station
              ? `${station.pageKey} · ${station.modeKey} · v${station.version}`
              : `bound to “${nodeLabel}”`}
          </p>
        </div>
        <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-text-soft">
          Read-only
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!node ? (
          <EmptyState
            icon="MousePointerClick"
            title="Select a node to inspect its station"
            body="Station detail (L2) shows the screen a single step binds to. Pick a step from the flow graph — double-click it at L1, or use the Inspector — to see its blocks, data sources, and actions here."
          />
        ) : loading ? (
          <p className="p-8 text-center text-sm text-text-faint">Loading the station…</p>
        ) : !station ? (
          <EmptyState
            icon="Layers"
            title="No station bound to this step yet"
            body="Bind a station_definition to this node (workflow_node_id) to compose what staff see and do here. Until then, the step runs as a pure process node."
          />
        ) : station.legacy ? (
          <EmptyState
            icon="Code2"
            title="Renders its original (legacy) layout"
            body={`“${station.label}” still uses its hand-coded screen — it hasn't been composed from blocks yet. Migrate it one slot at a time; the live page is unaffected.`}
          />
        ) : station.slots.length === 0 ? (
          <EmptyState
            icon="LayoutGrid"
            title="No blocks placed yet"
            body="This station is composed but every slot is empty. Add blocks to its trigger / queue / workspace / advance / header slots."
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {station.slots.map((slot) => (
              <section key={slot.slot}>
                <h3 className="mb-1.5 text-micro font-bold uppercase tracking-wider text-text-faint">
                  {SLOT_LABELS[slot.slot] ?? slot.slot}
                </h3>
                <div className="space-y-2">
                  {slot.blocks.map((b) => (
                    <div key={b.id} className="rounded-xl border border-border-soft bg-surface-card p-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Icon name={b.blockIcon} className="h-4 w-4 shrink-0 text-text-soft" />
                        <span className="text-sm font-bold text-text-default">{b.blockLabel}</span>
                        <span className="font-mono text-micro text-text-faint">{b.block}</span>
                        {b.doneWhen && (
                          <HoverTooltip label={`A row checks off when “${b.doneWhen}” succeeds`} asChild>
                            <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-micro font-semibold text-emerald-700">
                              done: {b.doneWhen}
                            </span>
                          </HoverTooltip>
                        )}
                      </div>

                      {/* Data source — where this block's rows flow IN from */}
                      {b.source ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-hairline pt-2 text-caption">
                          <span className="font-semibold text-text-faint">source</span>
                          <span className="font-semibold text-text-muted">{b.source.label}</span>
                          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-micro font-medium text-text-soft">
                            {b.source.integration}
                          </span>
                          <span className="font-mono text-micro text-text-faint">{b.source.endpoint}</span>
                          {b.source.realtimeChannel && (
                            <HoverTooltip label={`Live updates over ${b.source.realtimeChannel}`} asChild>
                              <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-micro font-semibold text-blue-700">
                                <icons.Radio className="h-3 w-3" /> {b.source.realtimeChannel}
                              </span>
                            </HoverTooltip>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 border-t border-border-hairline pt-2 text-caption text-text-faint">
                          no data source bound
                        </p>
                      )}

                      {/* Field mapping — role → source field */}
                      {Object.keys(b.fields).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {Object.entries(b.fields).map(([role, field]) => (
                            <span
                              key={role}
                              className="rounded bg-surface-canvas px-1.5 py-0.5 text-micro text-text-soft"
                            >
                              {role} → <span className="font-mono text-text-muted">{field}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Actions — what this block can fire OUT */}
                      {b.actions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-caption font-semibold text-text-faint">actions</span>
                          {b.actions.map((a) => (
                            <span
                              key={a.id}
                              className="inline-flex items-center gap-1 rounded-full border border-border-soft px-2 py-0.5 text-micro font-semibold text-text-muted"
                            >
                              <Icon name={a.icon} className="h-3 w-3" /> {a.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 p-10 text-center">
      <Icon name={icon} className="h-7 w-7 text-text-faint" />
      <p className="text-sm font-semibold text-text-muted">{title}</p>
      <p className="text-xs leading-relaxed text-text-soft">{body}</p>
    </div>
  );
}
