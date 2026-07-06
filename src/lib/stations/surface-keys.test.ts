/**
 * Guard + unit tests for the operator-surface registry (Phase 0).
 * Pure / DB-free: the registry, archetype decision, and resolver decision core
 * are all in-memory CODE.
 *
 *   node --import tsx --test src/lib/stations/surface-keys.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE_KEYS,
  SURFACE_REGISTRY,
  getSurface,
  listSurfaces,
  isSurfaceKey,
  surfaceForRoute,
} from './surface-keys';
import { ARCHETYPE_IDS, pickArchetype, isArchetypeId } from './archetype';
import { decideSurfaceRender } from './surface-resolver';
import type { StationConfig, StationDefinitionRow } from './contract';

// ─── Guard: every key has a complete, valid registry entry ───────────────────

test('registry: every SURFACE_KEY has a structurally complete entry', () => {
  for (const key of SURFACE_KEYS) {
    const def = SURFACE_REGISTRY[key];
    assert.ok(def, `${key} must have a registry entry`);
    assert.equal(def.key, key, `${key}: entry key must match the map key`);
    assert.ok(def.label.length > 0, `${key}: label required`);
    assert.ok(def.route.startsWith('/'), `${key}: route must be an absolute path`);
    assert.ok(isArchetypeId(def.archetype), `${key}: archetype must be a known archetype`);
    assert.ok(def.permission.length > 0, `${key}: permission required`);
    assert.ok(def.pageKey.length > 0, `${key}: pageKey required (Option A: station_definitions.page_key)`);
    assert.ok(def.modeKey.length > 0, `${key}: modeKey required`);
    assert.ok(def.scan === null || def.scan === 'unbox' || def.scan === 'triage', `${key}: scan policy`);
  }
});

test('registry: routes are unique and semantic (no numeric-hash paths)', () => {
  const routes = listSurfaces().map((s) => s.route);
  assert.equal(new Set(routes).size, routes.length, 'surface routes must be unique');
  for (const route of routes) {
    // No numeric surface hashes (/w/47, /v3/…) in a primary operator URL.
    assert.ok(!/\/(v\d+|w)\/\d+/.test(route), `${route}: no numeric-hash surface paths`);
    assert.ok(!/\/\d+(\/|$)/.test(route), `${route}: no bare numeric segment in a surface route`);
  }
});

test('registry: (pageKey, modeKey) pairs are unique — each surface resolves a distinct composition', () => {
  const pairs = listSurfaces().map((s) => `${s.pageKey}::${s.modeKey}`);
  assert.equal(new Set(pairs).size, pairs.length, 'each surface must map to a distinct (page_key, mode_key)');
});

// ─── isSurfaceKey / lookups ──────────────────────────────────────────────────

test('isSurfaceKey: narrows known keys, rejects the rest', () => {
  assert.equal(isSurfaceKey('unbox'), true);
  assert.equal(isSurfaceKey('triage'), true);
  assert.equal(isSurfaceKey('receiving'), false); // legacy page id is NOT a surface key
  assert.equal(isSurfaceKey(''), false);
  assert.equal(isSurfaceKey(null), false);
  assert.equal(isSurfaceKey(undefined), false);
});

test('getSurface: returns the same object as the registry', () => {
  assert.equal(getSurface('unbox'), SURFACE_REGISTRY.unbox);
  assert.equal(getSurface('unbox').route, '/unbox');
  assert.equal(getSurface('triage').label, 'Receiving');
});

test('surfaceForRoute: exact, nested, and longest-wins', () => {
  assert.equal(surfaceForRoute('/unbox')?.key, 'unbox');
  assert.equal(surfaceForRoute('/unbox/anything')?.key, 'unbox');
  assert.equal(surfaceForRoute('/triage')?.key, 'triage');
  // /receiving/history is nested under the /receiving legacy tree, not a surface
  // route prefix collision — history's route is /receiving/history and must win.
  assert.equal(surfaceForRoute('/receiving/history')?.key, 'history');
  assert.equal(surfaceForRoute('/dashboard'), null);
  assert.equal(surfaceForRoute(null), null);
});

// ─── pickArchetype (contextual-display decision algorithm) ───────────────────

test('pickArchetype: explicit hint always wins', () => {
  for (const a of ARCHETYPE_IDS) {
    assert.equal(pickArchetype({ archetype: a }), a);
  }
  // Hint overrides contradictory signals.
  assert.equal(pickArchetype({ archetype: 'workbench', inputModel: 'scanner' }), 'workbench');
});

test('pickArchetype: Q1 scanner short-circuits to Station', () => {
  assert.equal(pickArchetype({ inputModel: 'scanner' }), 'station');
  assert.equal(pickArchetype({ navigation: 'scan' }), 'station');
});

test('pickArchetype: Q2 observe-only + no persistence + no durable selection → Monitor', () => {
  assert.equal(
    pickArchetype({ job: 'observe', persistence: 'none', selection: 'ephemeral-or-none' }),
    'monitor',
  );
});

test('pickArchetype: Q3 node-graph + pan/zoom/focus → Canvas', () => {
  assert.equal(pickArchetype({ dataShape: 'node-graph', navigation: 'pan-zoom-focus' }), 'canvas');
});

test('pickArchetype: Q4 default fallthrough → Workbench', () => {
  assert.equal(pickArchetype({}), 'workbench');
  assert.equal(pickArchetype({ job: 'edit', navigation: 'pick', persistence: 'crud' }), 'workbench');
  // observe but something persists → NOT a monitor (drifted into Workbench).
  assert.equal(pickArchetype({ job: 'observe', persistence: 'crud' }), 'workbench');
});

test('registry archetypes agree with the surface intent', () => {
  assert.equal(getSurface('unbox').archetype, 'station');
  assert.equal(getSurface('triage').archetype, 'station');
  assert.equal(getSurface('incoming').archetype, 'workbench');
  assert.equal(getSurface('history').archetype, 'monitor');
});

// ─── decideSurfaceRender (resolver decision core) ────────────────────────────

function fakeRow(config: StationConfig, isActive = true): StationDefinitionRow {
  return {
    id: 1,
    pageKey: 'receiving',
    modeKey: 'receive',
    label: 'Unbox',
    workflowNodeId: null,
    config,
    version: 1,
    isActive,
    updatedBy: null,
    updatedAt: '2026-07-05T00:00:00.000Z',
  };
}

test('decideSurfaceRender: no active row → legacy', () => {
  const r = decideSurfaceRender(getSurface('unbox'), null);
  assert.equal(r.render, 'legacy');
  assert.equal(r.definition, null);
  assert.equal(r.archetype, 'station');
  assert.equal(r.key, 'unbox');
});

test('decideSurfaceRender: active row whose config is the legacy hatch → legacy', () => {
  const r = decideSurfaceRender(getSurface('unbox'), fakeRow({ slots: 'legacy' }));
  assert.equal(r.render, 'legacy');
  assert.ok(r.definition, 'the row is still returned even when we render legacy');
});

test('decideSurfaceRender: active row with a real slot map → composed', () => {
  const composedConfig: StationConfig = { slots: { queue: [{ id: 'blk_1', block: 'checklist' }] } };
  const r = decideSurfaceRender(getSurface('unbox'), fakeRow(composedConfig));
  assert.equal(r.render, 'composed');
  assert.equal(r.definition?.config, composedConfig);
});

test('decideSurfaceRender: an inactive row is never composed (safe default)', () => {
  const composedConfig: StationConfig = { slots: { queue: [{ id: 'blk_1', block: 'checklist' }] } };
  const r = decideSurfaceRender(getSurface('unbox'), fakeRow(composedConfig, /* isActive */ false));
  assert.equal(r.render, 'legacy');
});
