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
import { stepSimulation } from '@/lib/studio/simulate';
import type { StudioGraphEdge, StudioGraphNode } from './studio-types';
import type { StudioSimulation } from './useStudioSimulation';

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
      <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Simulate</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close Simulate"
          aria-label="Close Simulate"
          className="-my-1 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <p className="text-[11px] leading-snug text-slate-500">
          Walk a hypothetical unit through {editing ? 'this draft' : 'the graph'} — no real unit moves and
          nothing is saved.
        </p>

        {/* ─── Start / intake picker ─── */}
        {!sim.running ? (
          <div className="space-y-2">
            <PaneHeading text="Intake node" />
            <p className="text-[11px] text-slate-400">
              Start the ghost at the entry node, or pick any node to start from.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => sim.start()}
                className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
              >
                <Play className="h-3.5 w-3.5" /> Start at entry
              </button>
              <button
                type="button"
                onClick={() => sim.playHappyPath()}
                className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100"
              >
                <Sparkles className="h-3.5 w-3.5" /> Play happy path
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Or start from</p>
              <div className="flex flex-wrap gap-1">
                {nodes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => sim.start(n.id)}
                    title={`Start the ghost at ${labelOf(n.id)}`}
                    className="truncate rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                  >
                    {labelOf(n.id)}
                  </button>
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
                <p className="truncate font-mono text-[10px] text-violet-400">{currentNode?.type ?? ''}</p>
              </div>

              {sim.terminated ? (
                <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50 px-3 py-2.5 text-center">
                  <Flag className="mx-auto h-4 w-4 text-emerald-600" />
                  <p className="mt-1 text-xs font-semibold text-emerald-700">Reached a terminal</p>
                  <p className="mt-0.5 text-[11px] text-emerald-600">
                    The fired port has no outgoing edge — the run ends here.
                  </p>
                </div>
              ) : sim.currentPorts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                  <p className="text-xs font-semibold text-slate-600">No output ports</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">This node type declares no ports to fire.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fire a port</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sim.currentPorts.map((port) => {
                      const target = sim.currentNodeId
                        ? stepSimulation(nodes, edges, sim.currentNodeId, port.id).nextNodeId
                        : null;
                      return (
                      <button
                        key={port.id}
                        type="button"
                        onClick={() => sim.fire(port.id)}
                        title={target ? `Fire ${port.label} → ${labelOf(target)}` : `Fire ${port.label} → terminal`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                      >
                        <span className="rounded bg-slate-100 px-1 font-mono text-[9px] text-slate-500">
                          {port.id}
                        </span>
                        {port.label}
                      </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* ─── Run controls ─── */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => sim.stepBack()}
                disabled={sim.history.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Step back
              </button>
              {!sim.terminated && (
                <button
                  type="button"
                  onClick={() => sim.playHappyPath()}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Auto happy path
                </button>
              )}
              <button
                type="button"
                onClick={() => sim.reset()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>

            {/* ─── Path history ─── */}
            <section className="space-y-1.5">
              <PaneHeading text={`Path · ${sim.history.length} step${sim.history.length === 1 ? '' : 's'}`} />
              {sim.history.length === 0 ? (
                <p className="text-[11px] text-slate-400">Fire a port to begin walking the graph.</p>
              ) : (
                <ol className="space-y-1">
                  {sim.history.map((step, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-[11px]">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-700">
                        {i + 1}
                      </span>
                      <span className="truncate font-semibold text-slate-700">{labelOf(step.fromNodeId)}</span>
                      <span className="rounded bg-slate-100 px-1 font-mono text-[9px] text-slate-500">
                        {step.port}
                      </span>
                      {step.toNodeId ? (
                        <span className="truncate text-slate-500">→ {labelOf(step.toNodeId)}</span>
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
  return <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{text}</h3>;
}
