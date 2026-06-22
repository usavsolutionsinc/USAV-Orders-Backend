/**
 * Studio Simulate — pure, client-side ghost-run over a workflow graph
 * (Operations Studio ST6, Phase E2).
 *
 * A DRY-RUN that walks a hypothetical unit through the CURRENT graph (or the
 * draft being edited) so an owner can see the path BEFORE publishing. It is the
 * EXACT mirror of the engine's edge router (`src/lib/workflow/router.ts`
 * `selectNextTarget` — first-match-wins) so the ghost follows the same edges a
 * real unit would.
 *
 * HARD SAFETY CONSTRAINT: this module performs ZERO engine writes. No
 * `transition()` / `applyTransition()` / `tapWorkflow()`, no INSERT into
 * `inventory_events` / `workflow_runs` / `item_workflow_state`, no DB writes of
 * any kind, no fetch. It is pure in-memory routing over the graph the Studio
 * context already holds (Studio law #3 — lenses/overlays are render layers, not
 * reloads). There is therefore no server path that could mutate a real unit.
 *
 * The shape it takes (`{ id, source, sourcePort, target }` edges,
 * `{ id, meta.outputs }` nodes) is satisfied by `StudioGraphNode` /
 * `StudioGraphEdge`, so the canvas/context pass their in-context graph straight
 * in — including un-published draft edits.
 */

/** Minimal edge shape the simulation needs — `StudioGraphEdge` satisfies it. */
export interface SimEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
}

/** Minimal node shape the simulation needs — `StudioGraphNode` satisfies it. */
export interface SimNode {
  id: string;
  meta?: {
    outputs?: ReadonlyArray<{ id: string; label: string }>;
  } | null;
}

/** Outcome of advancing the ghost one hop along a fired output port. */
export interface SimStepResult {
  /** The node the ghost lands on, or null when the port routes nowhere (terminal). */
  nextNodeId: string | null;
  /** The edge traversed, or null when no edge matched the fired port (terminal). */
  edgeId: string | null;
}

/**
 * The entry node = the intake node: the one with no inbound edge. Mirrors the
 * static-flow projection's `isEntry`. When several qualify (a disconnected
 * graph) the first in document order wins — deterministic, matching the way the
 * canvas lays nodes out. Returns null for an empty graph or one that is fully
 * cyclic (every node has an inbound edge).
 */
export function findEntryNode(
  nodes: ReadonlyArray<SimNode>,
  edges: ReadonlyArray<SimEdge>,
): string | null {
  if (nodes.length === 0) return null;
  const hasInbound = new Set(edges.map((e) => e.target));
  const entry = nodes.find((n) => !hasInbound.has(n.id));
  return entry ? entry.id : null;
}

/**
 * Advance the ghost one hop: given the node it currently occupies and the
 * output port the owner chose to fire, resolve the next node via FIRST-MATCH
 * edge routing — byte-for-byte the engine's `selectNextTarget` semantics
 * (`edges.find(e => e.source === currentNodeId && e.sourcePort === firedPort)`).
 *
 * No match ⇒ a terminal: the run ends (`{ nextNodeId: null, edgeId: null }`).
 * If two edges share the same (node, port) the first wins, exactly as the
 * engine resolves it — the canvas prevents that fan-out, but we stay
 * deterministic regardless.
 */
export function stepSimulation(
  _nodes: ReadonlyArray<SimNode>,
  edges: ReadonlyArray<SimEdge>,
  currentNodeId: string,
  firedPort: string,
): SimStepResult {
  const match = edges.find(
    (e) => e.source === currentNodeId && e.sourcePort === firedPort,
  );
  return match
    ? { nextNodeId: match.target, edgeId: match.id }
    : { nextNodeId: null, edgeId: null };
}

/** The declared output ports of a node (empty when the type declares none). */
export function outputPortsOf(node: SimNode | null | undefined): Array<{ id: string; label: string }> {
  return node?.meta?.outputs ? [...node.meta.outputs] : [];
}
