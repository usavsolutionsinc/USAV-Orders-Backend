'use client';

/**
 * useStudioSimulation — the client-side ghost-run driver for the Operations
 * Studio (ST6 Simulate, Phase E2).
 *
 * A "ghost" dot walks a hypothetical unit through the in-context graph (the
 * CURRENT published graph, or the DRAFT being edited — whichever the workspace
 * is showing), driven by an outcome script: at each node the owner fires one
 * output port and the ghost hops along that edge. It is a pure dry-run:
 *
 *   ZERO engine writes. No transition()/applyTransition()/tapWorkflow(), no
 *   inventory_events / workflow_runs / item_workflow_state INSERT, no DB write,
 *   no fetch. Everything here is in-memory routing over the graph the Studio
 *   already holds, via the pure `src/lib/studio/simulate.ts` helpers — which
 *   mirror the engine's first-match edge router exactly so the ghost follows
 *   the same path a real unit would.
 *
 * State lives here (not in StudioWorkspaceContext's data fetch lifecycle) so the
 * simulation is a self-contained overlay that never triggers a graph reload or
 * re-layout (Studio law #3). The Shell mounts it once and threads its return
 * value into the Simulate panel + the canvas ghost props.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { findEntryNode, outputPortsOf, stepSimulation } from '@/lib/studio/simulate';
import type { StudioGraphEdge, StudioGraphNode } from './studio-types';

/** One recorded hop in the ghost's path. */
export interface SimStep {
  /** The node the ghost was sitting on when this port fired. */
  fromNodeId: string;
  /** The output port the owner fired. */
  port: string;
  /** The edge traversed, or null if the port was a terminal (run ended here). */
  edgeId: string | null;
  /** The node the ghost landed on, or null when the port routed nowhere. */
  toNodeId: string | null;
}

export interface StudioSimulation {
  /** Whether a ghost-run is active (the overlay paints only while true). */
  running: boolean;
  /** The node the ghost currently occupies (null when not running or terminated). */
  currentNodeId: string | null;
  /** True once the ghost reached a terminal (a fired port with no matching edge). */
  terminated: boolean;
  /** The path so far, oldest-first. */
  history: SimStep[];
  /** Edge ids the ghost has traversed (for tinting the canvas). */
  traversedEdgeIds: ReadonlySet<string>;
  /** Output ports of the node the ghost is on (the buttons to advance it). */
  currentPorts: Array<{ id: string; label: string }>;
  /** Start a run at `nodeId` (defaults to the graph's entry/intake node). */
  start: (nodeId?: string | null) => void;
  /** Fire one output port, advancing the ghost one hop (no-op when terminated). */
  fire: (port: string) => void;
  /** Auto-fire the first port at each node until terminal (happy path). */
  playHappyPath: () => void;
  /** Step back one hop (undo the last fire); ends the run if the history empties. */
  stepBack: () => void;
  /** Clear the run entirely. */
  reset: () => void;
}

/** Hard ceiling on auto-play hops so a cyclic graph (rework loop) can't spin forever. */
const MAX_AUTO_STEPS = 200;

export function useStudioSimulation(
  nodes: StudioGraphNode[],
  edges: StudioGraphEdge[],
): StudioSimulation {
  const [running, setRunning] = useState(false);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [terminated, setTerminated] = useState(false);
  const [history, setHistory] = useState<SimStep[]>([]);

  // Keep the latest graph in a ref so the auto-play loop reads fresh edges
  // without re-creating callbacks every render (the draft mutates as you edit).
  const graphRef = useRef({ nodes, edges });
  graphRef.current = { nodes, edges };

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const start = useCallback(
    (nodeId?: string | null) => {
      const { nodes: ns, edges: es } = graphRef.current;
      const entry = nodeId ?? findEntryNode(ns, es);
      if (!entry || !ns.some((n) => n.id === entry)) {
        setRunning(false);
        setCurrentNodeId(null);
        setTerminated(false);
        setHistory([]);
        return;
      }
      setRunning(true);
      setCurrentNodeId(entry);
      setTerminated(false);
      setHistory([]);
    },
    [],
  );

  const fire = useCallback((port: string) => {
    setCurrentNodeId((current) => {
      if (current == null) return current;
      const { nodes: ns, edges: es } = graphRef.current;
      const { nextNodeId, edgeId } = stepSimulation(ns, es, current, port);
      setHistory((h) => [...h, { fromNodeId: current, port, edgeId, toNodeId: nextNodeId }]);
      if (nextNodeId == null) {
        // A fired port with no matching edge = a terminal. The ghost stays put;
        // we flag the run as ended so the panel can offer reset.
        setTerminated(true);
        return current;
      }
      return nextNodeId;
    });
  }, []);

  const playHappyPath = useCallback(() => {
    const { nodes: ns, edges: es } = graphRef.current;
    let cursor = currentNodeId ?? findEntryNode(ns, es);
    if (!cursor || !ns.some((n) => n.id === cursor)) return;
    const steps: SimStep[] = [];
    const visited = new Set<string>();
    for (let i = 0; i < MAX_AUTO_STEPS; i++) {
      const node = ns.find((n) => n.id === cursor);
      const ports = outputPortsOf(node);
      if (ports.length === 0) break; // no port to fire → rest here
      const port = ports[0].id; // "happy path" = the first declared port
      const { nextNodeId, edgeId } = stepSimulation(ns, es, cursor!, port);
      steps.push({ fromNodeId: cursor!, port, edgeId, toNodeId: nextNodeId });
      if (nextNodeId == null) {
        setRunning(true);
        setTerminated(true);
        setCurrentNodeId(cursor);
        setHistory((h) => [...h, ...steps]);
        return;
      }
      // Stop if we'd revisit a node we already auto-stepped through (a loop):
      // the happy path is acyclic by intent; let the owner step a loop by hand.
      if (visited.has(nextNodeId)) break;
      visited.add(cursor!);
      cursor = nextNodeId;
    }
    setRunning(true);
    setTerminated(false);
    setCurrentNodeId(cursor);
    setHistory((h) => [...h, ...steps]);
  }, [currentNodeId]);

  const stepBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) {
        setRunning(false);
        setCurrentNodeId(null);
        setTerminated(false);
        return h;
      }
      const next = h.slice(0, -1);
      const last = h[h.length - 1];
      // Undo: the ghost returns to where the undone hop started.
      setCurrentNodeId(last.fromNodeId);
      setTerminated(false);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setCurrentNodeId(null);
    setTerminated(false);
    setHistory([]);
  }, []);

  const traversedEdgeIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const step of history) if (step.edgeId) set.add(step.edgeId);
    return set;
  }, [history]);

  const currentPorts = useMemo(
    () => (currentNodeId ? outputPortsOf(nodeById.get(currentNodeId)) : []),
    [currentNodeId, nodeById],
  );

  return {
    running,
    currentNodeId,
    terminated,
    history,
    traversedEdgeIds,
    currentPorts,
    start,
    fire,
    playHappyPath,
    stepBack,
    reset,
  };
}
