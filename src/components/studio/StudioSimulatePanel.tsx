'use client';

/**
 * StudioSimulatePanel — the Simulate authoring aid (Operations Studio ST6,
 * Phase E2). A read-only DRY-RUN: the owner walks a "ghost" unit through the
 * in-context graph (current published graph or the draft being edited) to see
 * the path BEFORE publishing.
 *
 * ZERO engine writes — every control here drives the pure
 * `useStudioSimulation` hook (in-memory routing over the graph). Available to
 * `studio.view`+ since it touches no real unit and writes nothing.
 *
 * House style: linear vertical scaffold, eyebrow headings, semantic tokens,
 * icon+text buttons. The ghost ring is painted on the canvas (StudioCanvas);
 * this panel is the control surface + path history.
 */

import { Play, RotateCcw, Sparkles, Flag, ChevronLeft, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { stepSimulation } from '@/lib/studio/simulate';
import type { StudioGraphEdge, StudioGraphNode } from './studio-types';
import type { StudioSimulation } from './useStudioSimulation';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface Props {
  sim: StudioSimulation;
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
  /** True while the workspace shows a draft (so the header can say so). */
  editing: boolean;
  /** Close the panel (also resets the run). */
  onClose: () => void;
}

export function StudioSimulatePanel({ sim, nodes, edges, editing, onClose }: Props) {
  const labelOf = (id: string | null | undefined) => {
    if (!id) return '—';
    const n = nodes.find((x) => x.id === id);
    return n?.meta?.label ?? n?.type ?? id;
  };
  const currentNode = sim.currentNodeId ? nodes.find((n) => n.id === sim.currentNodeId) ?? null : null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* ─── Header ─── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-micro font-bold uppercase tracking-wider text-text-soft">Simulate</span>
        </div>
        <HoverTooltip label="Close Simulate" asChild>
          <IconButton
            type="button"
            onClick={onClose}
            ariaLabel="Close Simulate"
            icon={<X className="h-3.5 w-3.5" />}
            className="-my-1 rounded p-1 text-text-faint transition-colors hover:bg-surface-sunken hover:text-text-muted"
          />
        </HoverTooltip>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <p className="text-caption leading-snug text-text-soft">
          Walk a hypothetical unit through {editing ? 'this draft' : 'the graph'} — no real unit moves and
          nothing is saved.
        </p>

        {/* ─── Start / intake picker ─── */}
        {!sim.running ? (
          <div className="space-y-2">
            <PaneHeading text="Intake node" />
            <p className="text-caption text-text-faint">
              Start the ghost at the entry node, or pick any node to start from.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => sim.start()}
                icon={<Play className="h-3.5 w-3.5" />}
                className="h-auto gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-violet-500"
              >
                Start at entry
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => sim.playHappyPath()}
                icon={<Sparkles className="h-3.5 w-3.5" />}
                className="h-auto gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
              >
                Play happy path
              </Button>
            </div>
            <div className="space-y-1">
              <p className="text-micro font-semibold uppercase tracking-wide text-text-faint">Or start from</p>
              <div className="flex flex-wrap gap-1">
                {nodes.map((n) => (
                  <HoverTooltip key={n.id} label={`Start the ghost at ${labelOf(n.id)}`} asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => sim.start(n.id)}
                      ariaLabel={`Start the ghost at ${labelOf(n.id)}`}
                      className="h-auto truncate rounded border border-border-soft bg-surface-card px-1.5 py-0.5 text-micro font-semibold text-text-muted hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                    >
                      {labelOf(n.id)}
                    </Button>
                  </HoverTooltip>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ─── Current node + ports ─── */}
            <section className="space-y-2">
              <PaneHeading text="Ghost is at" />
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2">
                <p className="truncate text-sm font-bold text-violet-800">{labelOf(sim.currentNodeId)}</p>
                <p className="truncate font-mono text-micro text-violet-400">{currentNode?.type ?? ''}</p>
              </div>

              {sim.terminated ? (
                <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50 px-3 py-2.5 text-center">
                  <Flag className="mx-auto h-4 w-4 text-emerald-600" />
                  <p className="mt-1 text-xs font-semibold text-emerald-700">Reached a terminal</p>
                  <p className="mt-0.5 text-caption text-emerald-600">
                    The fired port has no outgoing edge — the run ends here.
                  </p>
                </div>
              ) : sim.currentPorts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-3 py-2.5 text-center">
                  <p className="text-xs font-semibold text-text-muted">No output ports</p>
                  <p className="mt-0.5 text-caption text-text-faint">This node type declares no ports to fire.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-micro font-semibold uppercase tracking-wide text-text-faint">Fire a port</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sim.currentPorts.map((port) => {
                      const target = sim.currentNodeId
                        ? stepSimulation(nodes, edges, sim.currentNodeId, port.id).nextNodeId
                        : null;
                      return (
                      <HoverTooltip
                        key={port.id}
                        label={target ? `Fire ${port.label} → ${labelOf(target)}` : `Fire ${port.label} → terminal`}
                        asChild
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => sim.fire(port.id)}
                          ariaLabel={target ? `Fire ${port.label} → ${labelOf(target)}` : `Fire ${port.label} → terminal`}
                          className="h-auto gap-1 rounded-md border border-border-soft bg-surface-card px-2 py-1 text-xs font-semibold text-text-muted shadow-sm hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                        >
                          <span className="rounded bg-surface-sunken px-1 font-mono text-eyebrow text-text-soft">
                            {port.id}
                          </span>
                          {port.label}
                        </Button>
                      </HoverTooltip>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* ─── Run controls ─── */}
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => sim.stepBack()}
                disabled={sim.history.length === 0}
                icon={<ChevronLeft className="h-3.5 w-3.5" />}
                className="h-auto gap-1 rounded-md border border-border-soft bg-surface-card px-2 py-1 text-xs font-semibold text-text-muted hover:bg-surface-hover"
              >
                Step back
              </Button>
              {!sim.terminated && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => sim.playHappyPath()}
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  className="h-auto gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                >
                  Auto happy path
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => sim.reset()}
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                className="h-auto gap-1 rounded-md border border-border-soft bg-surface-card px-2 py-1 text-xs font-semibold text-text-muted hover:bg-surface-hover"
              >
                Reset
              </Button>
            </div>

            {/* ─── Path history ─── */}
            <section className="space-y-1.5">
              <PaneHeading text={`Path · ${sim.history.length} step${sim.history.length === 1 ? '' : 's'}`} />
              {sim.history.length === 0 ? (
                <p className="text-caption text-text-faint">Fire a port to begin walking the graph.</p>
              ) : (
                <ol className="space-y-1">
                  {sim.history.map((step, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-caption">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-100 text-eyebrow font-bold text-violet-700">
                        {i + 1}
                      </span>
                      <span className="truncate font-semibold text-text-muted">{labelOf(step.fromNodeId)}</span>
                      <span className="rounded bg-surface-sunken px-1 font-mono text-eyebrow text-text-soft">
                        {step.port}
                      </span>
                      {step.toNodeId ? (
                        <span className="truncate text-text-soft">→ {labelOf(step.toNodeId)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600">
                          <Flag className="h-3 w-3" /> terminal
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}

function PaneHeading({ text }: { text: string }) {
  return <h3 className="text-micro font-bold uppercase tracking-wider text-text-faint">{text}</h3>;
}
