/**
 * Workflow engine — edge router.
 *
 * Conditional routing is pure data: given the output port a node fired, find
 * the edge whose (sourceNode, sourcePort) matches and return its targetNode.
 * The "if inspection fails → repair" rule is just an edge from the inspection
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
 * Returns null when no edge matches (→ the item has reached a terminal node).
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
