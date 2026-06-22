/**
 * Workflow diagnostics — the linter for the operation (ST3, Studio law #5).
 *
 * Anything shaped like "warn the owner when X is misconfigured" is a rule
 * HERE returning Diagnostic rows — never a one-off banner in a component.
 * The Studio surfaces them through the Issues rail and the Gaps lens; ST4's
 * publish gate will refuse to activate a draft with any `error`-severity
 * diagnostic (severity contract: error blocks publish; warning/info never do).
 *
 * Pure module: rules take the graph rows + a port-lookup (the registry's
 * declared outputs per node type) so they unit-test without a DB and run
 * server-side in /api/studio/graph against live rows.
 *
 * v1 rules:
 *   unreachable-node  (error)   — node no item can ever reach from the entry
 *   dead-end-port     (error)   — a routing BRANCH that goes nowhere: an
 *                                 unwired declared port on a node that has
 *                                 other wired ports (the classic dangling
 *                                 `fail` — units pile up in limbo). A node
 *                                 with NO wired outputs is a terminal step,
 *                                 which is legitimate (engine marks runs
 *                                 done), so that surfaces as info instead.
 *   no-station        (warning) — node not bound to an operations-catalog
 *                                 station (nobody owns the step; the People
 *                                 lens and coverage checks need the binding)
 *   port-fan-out      (warning) — two+ edges leave the SAME output port. Routing
 *                                 is first-match-wins, so only the first fires
 *                                 and the rest are dead wiring — visible, not
 *                                 publish-blocking.
 *
 * Decision-node rules (Track 1, Stage 1 — only fire on `decision` nodes, whose
 * real ports live in config.outputs, not the static registry meta):
 *   decision-no-rules        (error) — a decision with NO rules AND no
 *                                      defaultPort parks every item forever.
 *   decision-port-undeclared (error) — a rule's thenPort (or the defaultPort)
 *                                      names a port the node doesn't declare in
 *                                      config.outputs — that lane can't be wired.
 *
 * Composition rules (only when station summaries are supplied — server-side):
 *   station-unmapped-role   (error) — a block in the node's bound station
 *                                     leaves a REQUIRED role unmapped, so it
 *                                     can't bind its data.
 *   station-unknown-action  (error) — a block references an action id that's
 *                                     no longer in the registry (dangling).
 */

import { findPortFanOuts, type WorkflowEdgeLike } from './router';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** Stable rule id + subject, e.g. 'dead-end-port:node-x:fail'. */
  id: string;
  severity: DiagnosticSeverity;
  rule:
    | 'unreachable-node'
    | 'dead-end-port'
    | 'terminal-node'
    | 'no-station'
    | 'station-unmapped-role'
    | 'station-unknown-action'
    | 'port-fan-out'
    | 'decision-no-rules'
    | 'decision-port-undeclared';
  nodeId?: string;
  edgeId?: string;
  message: string;
  /** One-line suggested fix shown in the Issues rail. */
  fix?: string;
}

/** One block instance in a node's bound station, resolved against the registry. */
export interface NodeStationBlockSummary {
  blockLabel: string;
  /** Role keys the block DECLARES as required. */
  requiredRoles: string[];
  /** Role keys the instance actually mapped to a source field. */
  mappedRoles: string[];
  /** Referenced action ids that are not in the registry. */
  unknownActions: string[];
}

/** A node's bound station composition (server-resolved by summarizeStations). */
export interface NodeStationSummary {
  label: string;
  /** The station still renders its hand-coded tree — not composed from blocks. */
  legacy: boolean;
  blocks: NodeStationBlockSummary[];
}

export interface DiagnosticsGraphNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface DiagnosticsGraphEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
}

export interface DiagnosticsInput {
  nodes: DiagnosticsGraphNode[];
  edges: DiagnosticsGraphEdge[];
  /** Declared output port ids for a node type (registry meta), or null when unknown. */
  portsOf: (type: string) => string[] | null;
  /** Valid station keys (operations-catalog STATIONS). */
  stationKeys: ReadonlySet<string>;
  /** Display label for a node (falls back to its type). */
  labelOf?: (node: DiagnosticsGraphNode) => string;
  /**
   * Per-node station composition summary, keyed by node id (server-resolved by
   * summarizeStations in src/lib/studio/station-diagnostics). Optional — omitted
   * client-side, where only the graph is edited, so composition rules stay quiet.
   */
  stationsByNode?: ReadonlyMap<string, NodeStationSummary>;
}

/** A decision node's declared output port ids, read from its config.outputs. */
function decisionOutputs(config: Record<string, unknown>): string[] {
  const raw = config.outputs;
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => String((o as Record<string, unknown>)?.id ?? '')).filter(Boolean);
}

/** A decision node's rule rows (thenPort only — the port-validity surface). */
function decisionThenPorts(config: Record<string, unknown>): string[] {
  const raw = config.rules;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => String((r as Record<string, unknown>)?.thenPort ?? '')).filter(Boolean);
}

/**
 * Declared ports for a node, decision-aware. Decision ports are per-instance
 * (config.outputs), so they override the static registry meta; every other node
 * falls back to portsOf(type).
 */
function declaredPortsFor(
  node: DiagnosticsGraphNode,
  portsOf: DiagnosticsInput['portsOf'],
): string[] | null {
  if (node.type === 'decision') return decisionOutputs(node.config);
  return portsOf(node.type);
}

export function runDiagnostics(input: DiagnosticsInput): Diagnostic[] {
  const { nodes, edges, portsOf, stationKeys } = input;
  const labelOf = input.labelOf ?? ((n: DiagnosticsGraphNode) => n.type);
  const out: Diagnostic[] = [];
  if (nodes.length === 0) return out;

  // ── Reachability from the entry set (nodes with no inbound edges). ──
  // A node with no inbound edges is an entry CANDIDATE — but one with no
  // edges at all is an island, not a second intake lane (verified in the
  // wild: a freshly dropped node reads as "entry" without this carve-out).
  // Single-node graphs are exempt (entry = terminal is a legitimate flow).
  const inbound = new Set(edges.map((e) => e.target));
  const outbound = new Set(edges.map((e) => e.source));
  const isIsland = (id: string) => nodes.length > 1 && !inbound.has(id) && !outbound.has(id);
  const entries = nodes.filter((n) => !inbound.has(n.id) && !isIsland(n.id));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.source) ?? [];
    list.push(e.target);
    adjacency.set(e.source, list);
  }
  const reachable = new Set<string>(entries.map((n) => n.id));
  const queue = [...reachable];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  for (const n of nodes) {
    if (!reachable.has(n.id)) {
      out.push({
        id: `unreachable-node:${n.id}`,
        severity: 'error',
        rule: 'unreachable-node',
        nodeId: n.id,
        message: isIsland(n.id)
          ? `“${labelOf(n)}” is disconnected — no edges in or out, items can never reach it.`
          : `“${labelOf(n)}” can never be reached — no path from the flow's entry leads here.`,
        fix: 'Wire an output port from an upstream step to this node, or remove it.',
      });
    }
  }

  // ── Port wiring: dangling branches vs legitimate terminals. ──
  const wiredPorts = new Map<string, Set<string>>();
  for (const e of edges) {
    const set = wiredPorts.get(e.source) ?? new Set<string>();
    set.add(e.sourcePort);
    wiredPorts.set(e.source, set);
  }
  for (const n of nodes) {
    const declared = declaredPortsFor(n, portsOf);
    if (!declared || declared.length === 0) continue;
    const wired = wiredPorts.get(n.id) ?? new Set<string>();
    const unwired = declared.filter((p) => !wired.has(p));

    if (wired.size === 0) {
      // Every port unrouted → the engine treats any fired port as run-done.
      // That's a designed terminal (e.g. ship), worth showing, not blocking.
      out.push({
        id: `terminal-node:${n.id}`,
        severity: 'info',
        rule: 'terminal-node',
        nodeId: n.id,
        message: `“${labelOf(n)}” is a terminal step — items finish their run here.`,
      });
      continue;
    }
    for (const port of unwired) {
      out.push({
        id: `dead-end-port:${n.id}:${port}`,
        severity: 'error',
        rule: 'dead-end-port',
        nodeId: n.id,
        message: `“${labelOf(n)}” routes some outcomes but its “${port}” lane goes nowhere — items taking it would silently finish.`,
        fix: `Wire the “${port}” port to the step that should handle it (or remove the branch).`,
      });
    }
  }

  // ── Decision-node rules (Track 1, Stage 1). ──
  // A decision routes via its config rule-table, whose real ports live in
  // config.outputs. Two ways an operator can strand items: an empty table with
  // no default (parks everything), or a rule pointing at a port the node never
  // declares (a lane that can't be wired).
  for (const n of nodes) {
    if (n.type !== 'decision') continue;
    const declared = new Set(decisionOutputs(n.config));
    const thenPorts = decisionThenPorts(n.config);
    const defaultPort =
      typeof n.config.defaultPort === 'string' && n.config.defaultPort ? n.config.defaultPort : null;

    if (thenPorts.length === 0 && !defaultPort) {
      out.push({
        id: `decision-no-rules:${n.id}`,
        severity: 'error',
        rule: 'decision-no-rules',
        nodeId: n.id,
        message: `“${labelOf(n)}” has no rules and no default port — every item would park here forever.`,
        fix: 'Add at least one rule, or set a default port in the decision editor.',
      });
    }

    const referenced = defaultPort ? [...thenPorts, defaultPort] : thenPorts;
    for (const port of new Set(referenced)) {
      if (declared.has(port)) continue;
      out.push({
        id: `decision-port-undeclared:${n.id}:${port}`,
        severity: 'error',
        rule: 'decision-port-undeclared',
        nodeId: n.id,
        message: `“${labelOf(n)}” routes to “${port}”, which isn't one of its declared output ports.`,
        fix: `Add “${port}” to the node's outputs, or point the rule at an existing port.`,
      });
    }
  }

  // ── Ambiguity guard: first-match-wins fan-out off a single port. ──
  // Routing is deterministic (the first wired edge wins), so a second edge off
  // the SAME port is silently dead. Surface it — don't block publish.
  const edgeLikes: WorkflowEdgeLike[] = edges.map((e) => ({
    sourceNode: e.source,
    sourcePort: e.sourcePort,
    targetNode: e.target,
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const fan of findPortFanOuts(edgeLikes)) {
    const node = nodeById.get(fan.sourceNode);
    const label = node ? labelOf(node) : fan.sourceNode;
    out.push({
      id: `port-fan-out:${fan.sourceNode}:${fan.sourcePort}`,
      severity: 'warning',
      rule: 'port-fan-out',
      nodeId: fan.sourceNode,
      message: `“${label}” has ${fan.targets.length} edges off its “${fan.sourcePort}” port — routing is first-match-wins, so only the first fires.`,
      fix: `Keep one edge on the “${fan.sourcePort}” port (use a decision node to fan out on conditions).`,
    });
  }

  // ── Station binding. ──
  for (const n of nodes) {
    const station = String(n.config.station ?? '');
    if (!station || !stationKeys.has(station)) {
      out.push({
        id: `no-station:${n.id}`,
        severity: 'warning',
        rule: 'no-station',
        nodeId: n.id,
        message: `“${labelOf(n)}” has no station bound — nobody on the floor owns this step.`,
        fix: 'Set config.station to an operations-catalog station key.',
      });
    }
  }

  // ── Station composition (only when summaries are supplied — server-side). ──
  if (input.stationsByNode) {
    for (const n of nodes) {
      const summary = input.stationsByNode.get(n.id);
      if (!summary || summary.legacy) continue;
      for (const block of summary.blocks) {
        for (const role of block.requiredRoles) {
          if (block.mappedRoles.includes(role)) continue;
          out.push({
            id: `station-unmapped-role:${n.id}:${block.blockLabel}:${role}`,
            severity: 'error',
            rule: 'station-unmapped-role',
            nodeId: n.id,
            message: `“${labelOf(n)}” station — the “${block.blockLabel}” block needs its “${role}” field bound, but nothing is mapped.`,
            fix: `Map the “${role}” role to a source field in the station's Config Sheet.`,
          });
        }
        for (const action of block.unknownActions) {
          out.push({
            id: `station-unknown-action:${n.id}:${block.blockLabel}:${action}`,
            severity: 'error',
            rule: 'station-unknown-action',
            nodeId: n.id,
            message: `“${labelOf(n)}” station — the “${block.blockLabel}” block references action “${action}”, which no longer exists.`,
            fix: `Remove the “${action}” action from the block, or register it.`,
          });
        }
      }
    }
  }

  const order: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
}
