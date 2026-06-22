/**
 * Workflow engine — edge router.
 *
 * Conditional routing is pure data: given the output port a node fired, find
 * the edge whose (sourceNode, sourcePort) matches and return its targetNode.
 * The "if inspection fails -> repair" rule is just an edge from the inspection
 * node's `fail` port to the repair node — no branching code.
 *
 * `selectNextTarget` is pure (in-memory edges) so it's trivially unit-testable;
 * the DB-backed lookup lives in the Drizzle store (store.ts).
 */

export interface WorkflowEdgeLike {
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
}

/**
 * Resolve the next node for (sourceNode, sourcePort) from an in-memory edge set.
 * Returns null when no edge matches (-> the item has reached a terminal node).
 *
 * If multiple edges share the same (sourceNode, sourcePort) the first wins; the
 * canvas should prevent fan-out from a single port, but we stay deterministic.
 */
export function selectNextTarget(
  edges: readonly WorkflowEdgeLike[],
  sourceNode: string,
  sourcePort: string,
): string | null {
  const match = edges.find(
    (e) => e.sourceNode === sourceNode && e.sourcePort === sourcePort,
  );
  return match ? match.targetNode : null;
}

/** A single (sourceNode, sourcePort) that more than one edge fans out from. */
export interface PortFanOut {
  sourceNode: string;
  sourcePort: string;
  /** The target nodes the port fans to, in edge order (the first one wins at runtime). */
  targets: string[];
}

/**
 * Ambiguity guard for first-match-wins routing.
 *
 * `selectNextTarget` is deterministic (first matching edge wins) but SILENT
 * about ambiguity: if an operator wires two edges off the same output port,
 * runtime quietly takes the first and the second never fires. This finds those
 * fan-outs so the Studio can flag them — it does NOT change routing (the runtime
 * still first-match-wins); it only makes the ambiguity visible.
 *
 * Pure (in-memory edges), so the diagnostics linter and tests share it.
 */
export function findPortFanOuts(edges: readonly WorkflowEdgeLike[]): PortFanOut[] {
  const byPort = new Map<string, PortFanOut>();
  for (const e of edges) {
    const key = `${e.sourceNode}::${e.sourcePort}`;
    const entry = byPort.get(key);
    if (entry) {
      entry.targets.push(e.targetNode);
    } else {
      byPort.set(key, {
        sourceNode: e.sourceNode,
        sourcePort: e.sourcePort,
        targets: [e.targetNode],
      });
    }
  }
  return [...byPort.values()].filter((p) => p.targets.length > 1);
}
