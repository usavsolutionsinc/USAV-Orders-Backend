import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS,
  PERMISSION_CATEGORY_DEFS,
  REGISTRY_ALL_PERMISSIONS,
  REGISTRY_STEP_UP_PERMISSIONS,
  REGISTRY_DESTRUCTIVE_PERMISSIONS,
  REGISTRY_PERMISSION_CATEGORIES,
  isKnownPermission,
  permissionLabel,
} from './permission-registry';

test('registry: every id is unique', () => {
  const seen = new Set<string>();
  for (const p of PERMISSIONS) {
    assert.equal(seen.has(p.id), false, `duplicate id: ${p.id}`);
    seen.add(p.id);
  }
});

test('registry: every entry has a label that ends without trailing whitespace', () => {
  for (const p of PERMISSIONS) {
    assert.ok(p.label.length > 0, `empty label for ${p.id}`);
    assert.equal(p.label, p.label.trim(), `whitespace label for ${p.id}`);
  }
});

test('registry: every category id used by a permission is declared in PERMISSION_CATEGORY_DEFS', () => {
  const declared = new Set(PERMISSION_CATEGORY_DEFS.map((c) => c.id));
  for (const p of PERMISSIONS) {
    assert.equal(declared.has(p.category), true, `permission ${p.id} uses undeclared category ${p.category}`);
  }
});

test('REGISTRY_ALL_PERMISSIONS contains every registered id', () => {
  for (const p of PERMISSIONS) {
    assert.equal(REGISTRY_ALL_PERMISSIONS.has(p.id), true, `missing from ALL: ${p.id}`);
  }
  assert.equal(REGISTRY_ALL_PERMISSIONS.size, PERMISSIONS.length);
});

test('REGISTRY_STEP_UP_PERMISSIONS only contains stepUp=true entries', () => {
  for (const id of REGISTRY_STEP_UP_PERMISSIONS) {
    const def = PERMISSIONS.find((p) => p.id === id);
    assert.ok(def, `step-up id not in registry: ${id}`);
    assert.equal((def as { stepUp?: boolean }).stepUp, true, `step-up registered for non-stepUp permission ${id}`);
  }
});

test('REGISTRY_DESTRUCTIVE_PERMISSIONS only contains destructive=true entries', () => {
  for (const id of REGISTRY_DESTRUCTIVE_PERMISSIONS) {
    const def = PERMISSIONS.find((p) => p.id === id);
    assert.ok(def, `destructive id not in registry: ${id}`);
    assert.equal((def as { destructive?: boolean }).destructive, true);
  }
});

test('every stepUp permission is also destructive (current convention)', () => {
  for (const id of REGISTRY_STEP_UP_PERMISSIONS) {
    const def = PERMISSIONS.find((p) => p.id === id);
    assert.equal((def as { destructive?: boolean }).destructive, true,
      `convention break: stepUp without destructive: ${id}`);
  }
});

test('REGISTRY_PERMISSION_CATEGORIES preserves PERMISSION_CATEGORY_DEFS order', () => {
  assert.deepEqual(
    REGISTRY_PERMISSION_CATEGORIES.map((c) => c.id),
    PERMISSION_CATEGORY_DEFS.map((c) => c.id),
  );
});

test('REGISTRY_PERMISSION_CATEGORIES: each category lists every permission in that category', () => {
  for (const cat of REGISTRY_PERMISSION_CATEGORIES) {
    const expected = PERMISSIONS.filter((p) => p.category === cat.id).map((p) => p.id);
    assert.deepEqual(cat.permissions, expected, `category ${cat.id} drift`);
  }
});

test('isKnownPermission: positive and negative cases', () => {
  assert.equal(isKnownPermission('work_orders.view'), true);
  assert.equal(isKnownPermission('this.does.not.exist'), false);
  assert.equal(isKnownPermission(''), false);
});

test('permissionLabel: known permission returns the registered label, unknown returns the id', () => {
  assert.equal(permissionLabel('work_orders.view'), 'View work orders');
  // @ts-expect-error — exercising the runtime fallback for invalid input
  assert.equal(permissionLabel('made.up.permission'), 'made.up.permission');
});

test('regression: work_orders.view is registered (was missing from DB seed and broke tech queue)', () => {
  assert.equal(REGISTRY_ALL_PERMISSIONS.has('work_orders.view'), true);
});
