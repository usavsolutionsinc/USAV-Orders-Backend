/**
 * Unit tests for navigation-as-data merge (Phase 4). Pure / DB-free.
 *   node --import tsx --test src/lib/nav/org-nav.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOrgNav, parseNavDefinition, type NavDefinition } from './org-nav';
import type { SidebarNavItem } from '@/lib/sidebar-navigation';

const Icon = () => null as unknown as JSX.Element;
const defaults: SidebarNavItem[] = [
  { id: 'operations', label: 'Operations', href: '/operations', icon: Icon, kind: 'main' },
  { id: 'receiving', label: 'Receiving', href: '/unbox', icon: Icon, kind: 'station' },
  { id: 'outbound', label: 'Outbound', href: '/outbound', icon: Icon, kind: 'station' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Icon, kind: 'bottom' },
];

test('null / empty override returns defaults unchanged (safe default)', () => {
  assert.deepEqual(mergeOrgNav(defaults, null).map((i) => i.id), defaults.map((i) => i.id));
  assert.deepEqual(mergeOrgNav(defaults, { entries: [] }).map((i) => i.id), defaults.map((i) => i.id));
});

test('hidden removes an item', () => {
  const override: NavDefinition = { entries: [{ id: 'outbound', hidden: true }] };
  const ids = mergeOrgNav(defaults, override).map((i) => i.id);
  assert.deepEqual(ids, ['operations', 'receiving', 'settings']);
});

test('label renames an item without moving it', () => {
  const override: NavDefinition = { entries: [{ id: 'receiving', label: 'Intake' }] };
  const merged = mergeOrgNav(defaults, override);
  assert.equal(merged.find((i) => i.id === 'receiving')?.label, 'Intake');
  assert.deepEqual(merged.map((i) => i.id), defaults.map((i) => i.id));
});

test('order floats an item to its slot; unset items keep relative order', () => {
  const override: NavDefinition = { entries: [{ id: 'outbound', order: 0 }] };
  const ids = mergeOrgNav(defaults, override).map((i) => i.id);
  // outbound (order 0) leads; the rest keep default relative order.
  assert.equal(ids[0], 'outbound');
  assert.deepEqual(ids.slice(1), ['operations', 'receiving', 'settings']);
});

test('an override cannot introduce an unknown item — it only references existing ids', () => {
  const override: NavDefinition = { entries: [{ id: 'not-a-real-page', label: 'Ghost', order: 0 }] };
  const ids = mergeOrgNav(defaults, override).map((i) => i.id);
  assert.deepEqual(ids, defaults.map((i) => i.id));
  assert.ok(!ids.includes('not-a-real-page'));
});

test('combined hide + rename + reorder', () => {
  const override: NavDefinition = {
    entries: [
      { id: 'operations', hidden: true },
      { id: 'receiving', label: 'Intake', order: 0 },
      { id: 'outbound', order: 1 },
    ],
  };
  const merged = mergeOrgNav(defaults, override);
  assert.deepEqual(merged.map((i) => i.id), ['receiving', 'outbound', 'settings']);
  assert.equal(merged[0].label, 'Intake');
});

test('parseNavDefinition narrows jsonb defensively', () => {
  assert.equal(parseNavDefinition(null), null);
  assert.equal(parseNavDefinition({ nope: 1 }), null);
  assert.deepEqual(
    parseNavDefinition({ entries: [{ id: 'a', hidden: true }, { id: 42 }, { bad: 1 }, { id: 'b', order: 2, label: 'B' }] }),
    { entries: [{ id: 'a', hidden: true }, { id: 'b', order: 2, label: 'B' }] },
  );
});
