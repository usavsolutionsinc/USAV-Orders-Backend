/**
 * Per-page assistant skill fragments (plan §-2.2) — prompt text a page
 * registers through useAssistantContext so the assistant speaks that page's
 * language. Kept in one reviewed module (not scattered string literals);
 * server-side length cap is 4000 chars per fragment.
 */

export const OPERATIONS_SKILL = [
  'This page is the Operations Monitor (read-only): live activity, analytics (KPI strip, throughput, station distribution, "You vs typical" benchmarks), and history over the org-scoped event spine.',
  'Useful tools here: get_kpis (event counts by type), get_top_reasons, get_signals_by_node, get_benchmarks (seeded vertical benchmarks — compare against the actuals from get_kpis).',
  'URL modes: /operations?mode=live|analytics|insights|history; analytics accepts ?range=24h|7d|30d and ?section= anchors (e.g. section=benchmarks).',
].join('\n');

export const STUDIO_SKILL = [
  'This page is the Operations Studio: a node-graph canvas of the org\'s workflow (L0 departments ⇄ L1 process nodes) with overlay lenses (live occupancy, flow metrics, people coverage, gaps/diagnostics).',
  'Useful tools here: get_graph (nodes + edges of the active definition or a draft by definitionId), get_node_detail (config, wiring, live occupancy, surfaces, recent signals for one node), get_signals_by_node.',
  'URL state: /studio?v=<definitionId>&focus=<nodeId>&z=0|1|2&lens=live|flow|people|gaps|static — navigate can deep-link any view. Nodes route items by output ports; decision nodes carry per-instance rules in config.',
  'Editing note: the canvas is read-only here; graph changes are draft-based and publish is a human-gated action.',
].join('\n');

export const STATION_SKILL = [
  'This page is a scan-driven Station bench: the operator scans items (tracking / serial / SKU) and the active card replaces per scan. Keep answers short — the operator is mid-flow with hands on product.',
  'Useful tools here: get_unit_journey (a serial\'s full story: status, engine position, events, signals), search_notes (free-text over reasons/notes), get_top_reasons for "why do these keep failing".',
].join('\n');
