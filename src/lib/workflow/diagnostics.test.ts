/**
 * Diagnostics rules (ST3) — unit tests over synthetic graphs, including the
 * seeded refurb-v1 shape which must lint CLEAN (no errors/warnings; the ship
 * terminal surfaces as info only).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runDiagnostics, type DiagnosticsInput } from './diagnostics';

const PORTS: Record<string, string[]> = {
  receiving: ['received'],
  inspection: ['pass', 'fail'],
  repair: ['repaired'],
  list_ebay: ['listed'],
  pack: ['packed'],
  ship: ['shipped'],
};

const STATIONS = new Set(['RECEIVING', 'TECH', 'PACK', 'LABELS', 'FBA', 'ADMIN']);

function input(overrides: Partial<DiagnosticsInput>): DiagnosticsInput {
  return {
    nodes: [],
    edges: [],
    portsOf: (type) => PORTS[type] ?? null,
    stationKeys: STATIONS,
    ...overrides,
  };
}

const node = (id: string, type: string, station: string | null = 'TECH') => ({
  id,
  type,
  config: station ? { station } : {},
});
const edge = (id: string, source: string, sourcePort: string, target: string) => ({
  id,
  source,
  sourcePort,
  target,
});

test('the seeded refurb-v1 shape lints clean (info-only)', () => {
  const diags = runDiagnostics(
    input({
      nodes: [
        node('receive', 'receiving', 'RECEIVING'),
        node('test', 'inspection', 'TECH'),
        node('repair', 'repair', 'TECH'),
        node('list', 'list_ebay', 'ADMIN'),
        node('pack', 'pack', 'PACK'),
        node('ship', 'ship', 'PACK'),
      ],
      edges: [
        edge('e1', 'receive', 'received', 'test'),
        edge('e2', 'test', 'pass', 'list'),
        edge('e3', 'test', 'fail', 'repair'),
        edge('e4', 'repair', 'repaired', 'test'),
        edge('e5', 'list', 'listed', 'pack'),
        edge('e6', 'pack', 'packed', 'ship'),
      ],
    }),
  );
  assert.deepEqual(
    diags.filter((d) => d.severity !== 'info'),
    [],
    `expected clean, got: ${JSON.stringify(diags)}`,
  );
  // ship is the designed terminal.
  assert.ok(diags.some((d) => d.rule === 'terminal-node' && d.nodeId === 'ship'));
});

test('unreachable-node: an island node errors', () => {
  const diags = runDiagnostics(
    input({
      nodes: [
        node('a', 'receiving', 'RECEIVING'),
        node('b', 'inspection', 'TECH'),
        node('island', 'pack', 'PACK'),
      ],
      edges: [
        edge('e1', 'a', 'received', 'b'),
        // island has an outgoing edge but nothing feeds it…
        edge('e2', 'island', 'packed', 'b'),
      ],
    }),
  );
  // …yet island has no inbound edge, making it an entry candidate. A true
  // island is one with an inbound edge from another unreachable node only —
  // simplest case: give it an inbound from itself? Instead test the real
  // shape: a node whose only inbound comes from another orphan.
  assert.equal(diags.filter((d) => d.rule === 'unreachable-node').length, 0);

  const diags2 = runDiagnostics(
    input({
      nodes: [
        node('a', 'receiving', 'RECEIVING'),
        node('b', 'ship', 'PACK'),
        node('loop1', 'pack', 'PACK'),
        node('loop2', 'list_ebay', 'ADMIN'),
      ],
      edges: [
        edge('e1', 'a', 'received', 'b'),
        // loop1 ⇄ loop2 feed each other but nothing from the entry reaches them.
        edge('e2', 'loop1', 'packed', 'loop2'),
        edge('e3', 'loop2', 'listed', 'loop1'),
      ],
    }),
  );
  const unreachable = diags2.filter((d) => d.rule === 'unreachable-node').map((d) => d.nodeId);
  assert.deepEqual(unreachable.sort(), ['loop1', 'loop2']);
});

test('dead-end-port: a dangling fail lane errors; full terminal is info', () => {
  const diags = runDiagnostics(
    input({
      nodes: [
        node('test', 'inspection', 'TECH'),
        node('list', 'list_ebay', 'ADMIN'),
      ],
      edges: [
        // pass is wired, fail goes nowhere — the classic limbo pile.
        edge('e1', 'test', 'pass', 'list'),
      ],
    }),
  );
  const deadEnd = diags.find((d) => d.rule === 'dead-end-port');
  assert.ok(deadEnd, 'expected a dead-end-port diagnostic');
  assert.equal(deadEnd?.severity, 'error');
  assert.equal(deadEnd?.nodeId, 'test');
  assert.match(deadEnd!.message, /fail/);
  // list has zero wired ports → terminal info, not an error.
  assert.ok(diags.some((d) => d.rule === 'terminal-node' && d.nodeId === 'list'));
});

test('no-station: missing or unknown station key warns', () => {
  const diags = runDiagnostics(
    input({
      nodes: [node('a', 'receiving', null), node('b', 'pack', 'NOT_A_STATION')],
      edges: [edge('e1', 'a', 'received', 'b')],
    }),
  );
  const noStation = diags.filter((d) => d.rule === 'no-station');
  assert.deepEqual(noStation.map((d) => d.nodeId).sort(), ['a', 'b']);
  assert.ok(noStation.every((d) => d.severity === 'warning'));
});

test('a fully disconnected island node is unreachable, not a second entry', () => {
  const diags = runDiagnostics(
    input({
      nodes: [
        node('a', 'receiving', 'RECEIVING'),
        node('b', 'ship', 'PACK'),
        node('orphan', 'pack', 'PACK'),
      ],
      edges: [edge('e1', 'a', 'received', 'b')],
    }),
  );
  const unreachable = diags.filter((d) => d.rule === 'unreachable-node');
  assert.deepEqual(unreachable.map((d) => d.nodeId), ['orphan']);
  assert.match(unreachable[0].message, /disconnected/);
});

test('a single-node graph is legitimate (entry = terminal, no errors)', () => {
  const diags = runDiagnostics(
    input({ nodes: [node('only', 'receiving', 'RECEIVING')], edges: [] }),
  );
  assert.deepEqual(diags.filter((d) => d.severity === 'error'), []);
});

test('unknown node types skip port rules without throwing', () => {
  const diags = runDiagnostics(
    input({
      nodes: [node('x', 'mystery_type', 'TECH')],
      edges: [],
    }),
  );
  assert.equal(diags.filter((d) => d.rule === 'dead-end-port').length, 0);
});

test('errors sort before warnings before info', () => {
  const diags = runDiagnostics(
    input({
      nodes: [
        node('test', 'inspection', null), // no-station warning + dangling fail error
        node('list', 'list_ebay', 'ADMIN'), // terminal info
      ],
      edges: [edge('e1', 'test', 'pass', 'list')],
    }),
  );
  const severities = diags.map((d) => d.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 } as const;
    return order[a as keyof typeof order] - order[b as keyof typeof order];
  }));
});

// ── Composition rules (only when station summaries are supplied) ──

test('station-unmapped-role: a required role with no mapping errors', () => {
  const diags = runDiagnostics(
    input({
      nodes: [node('test', 'inspection', 'TECH')],
      edges: [],
      stationsByNode: new Map([
        [
          'test',
          {
            label: 'Tech Bench',
            legacy: false,
            blocks: [
              { blockLabel: 'Checklist', requiredRoles: ['title', 'ref'], mappedRoles: ['title'], unknownActions: [] },
            ],
          },
        ],
      ]),
    }),
  );
  const unmapped = diags.filter((d) => d.rule === 'station-unmapped-role');
  assert.equal(unmapped.length, 1);
  assert.equal(unmapped[0].severity, 'error');
  assert.equal(unmapped[0].nodeId, 'test');
  assert.match(unmapped[0].message, /ref/);
});

test('station-unknown-action: a dangling action id errors', () => {
  const diags = runDiagnostics(
    input({
      nodes: [node('test', 'inspection', 'TECH')],
      edges: [],
      stationsByNode: new Map([
        [
          'test',
          {
            label: 'Tech Bench',
            legacy: false,
            blocks: [{ blockLabel: 'Checklist', requiredRoles: [], mappedRoles: [], unknownActions: ['ghost.action'] }],
          },
        ],
      ]),
    }),
  );
  const unknown = diags.filter((d) => d.rule === 'station-unknown-action');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].severity, 'error');
  assert.match(unknown[0].message, /ghost\.action/);
});

test('composition: legacy stations skipped, fully-mapped blocks lint clean', () => {
  const diags = runDiagnostics(
    input({
      nodes: [node('a', 'inspection', 'TECH'), node('b', 'inspection', 'TECH')],
      edges: [edge('e1', 'a', 'pass', 'b'), edge('e2', 'a', 'fail', 'b')],
      stationsByNode: new Map([
        // legacy → skipped wholesale even though it has gaps
        ['a', { label: 'A', legacy: true, blocks: [{ blockLabel: 'X', requiredRoles: ['title'], mappedRoles: [], unknownActions: ['nope'] }] }],
        // fully mapped, no dangling actions → clean
        ['b', { label: 'B', legacy: false, blocks: [{ blockLabel: 'Checklist', requiredRoles: ['title'], mappedRoles: ['title'], unknownActions: [] }] }],
      ]),
    }),
  );
  assert.equal(diags.filter((d) => d.rule.startsWith('station-')).length, 0);
});

test('composition rules stay quiet when no summaries are supplied (client re-lint)', () => {
  const diags = runDiagnostics(input({ nodes: [node('test', 'inspection', 'TECH')], edges: [] }));
  assert.equal(diags.filter((d) => d.rule.startsWith('station-')).length, 0);
});
