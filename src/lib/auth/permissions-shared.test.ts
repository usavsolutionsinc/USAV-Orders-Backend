import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ROLE_KEY,
  ALL_PERMISSIONS,
  canonicalRole,
  computeEffectivePermissions,
  isAdminRoleKey,
  rolesIncludeAdmin,
  requiresStepUp,
  unionRolePermissions,
  type PermissionString,
} from './permissions-shared';

test('ADMIN_ROLE_KEY is the literal "admin"', () => {
  assert.equal(ADMIN_ROLE_KEY, 'admin');
});

test('isAdminRoleKey: matches "admin", rejects everything else', () => {
  assert.equal(isAdminRoleKey('admin'), true);
  assert.equal(isAdminRoleKey('Admin'), false);
  assert.equal(isAdminRoleKey('technician'), false);
  assert.equal(isAdminRoleKey(''), false);
  assert.equal(isAdminRoleKey(null), false);
  assert.equal(isAdminRoleKey(undefined), false);
});

test('rolesIncludeAdmin: returns true when any role.key is admin', () => {
  assert.equal(rolesIncludeAdmin([{ key: 'technician' }, { key: 'admin' }]), true);
  assert.equal(rolesIncludeAdmin([{ key: 'admin' }]), true);
  assert.equal(rolesIncludeAdmin([{ key: 'technician' }, { key: 'packer' }]), false);
  assert.equal(rolesIncludeAdmin([]), false);
});

test('canonicalRole: aliases legacy keys', () => {
  assert.equal(canonicalRole('receiving'), 'receiver');
  assert.equal(canonicalRole('readonly'), 'viewer');
  assert.equal(canonicalRole('admin'), 'admin');
  assert.equal(canonicalRole('technician'), 'technician');
  assert.equal(canonicalRole('unknown'), 'unknown');
});

test('requiresStepUp: positive for destructive perms, negative for benign ones', () => {
  assert.equal(requiresStepUp('orders.void'), true);
  assert.equal(requiresStepUp('bin.remove'), true);
  assert.equal(requiresStepUp('cycle_count.approve'), true);
  assert.equal(requiresStepUp('work_orders.view'), false);
  assert.equal(requiresStepUp('dashboard.view'), false);
});

test('unionRolePermissions: unions across roles, drops unknown strings', () => {
  const set = unionRolePermissions([
    { permissions: ['receiving.view', 'receiving.scan_po'] },
    { permissions: ['packing.view', 'this.is.bogus'] },
    { permissions: ['receiving.view'] }, // duplicate — set semantics
  ]);
  assert.equal(set.has('receiving.view'), true);
  assert.equal(set.has('receiving.scan_po'), true);
  assert.equal(set.has('packing.view'), true);
  assert.equal(set.has('this.is.bogus' as PermissionString), false);
  assert.equal(set.size, 3);
});

test('computeEffectivePermissions: admin role short-circuits to ALL_PERMISSIONS', () => {
  const result = computeEffectivePermissions(
    [{ key: 'admin', permissions: ['garbage', 'whatever'] }],
    [],
    [],
  );
  assert.equal(result.size, ALL_PERMISSIONS.size);
  // Sample a couple of admin-only perms not present in the role row's array
  assert.equal(result.has('admin.view'), true);
  assert.equal(result.has('orders.void'), true);
  // Garbage strings are NOT promoted
  assert.equal(result.has('garbage' as PermissionString), false);
});

test('computeEffectivePermissions: admin short-circuits even when overrides try to remove', () => {
  // Discord-style — admin ignores overrides to prevent self-lockout.
  const result = computeEffectivePermissions(
    [{ key: 'admin', permissions: [] }],
    [],
    ['admin.view'],
  );
  assert.equal(result.has('admin.view'), true);
});

test('computeEffectivePermissions: non-admin unions role permissions', () => {
  const result = computeEffectivePermissions(
    [
      { key: 'receiver', permissions: ['receiving.view'] },
      { key: 'packer', permissions: ['packing.view'] },
    ],
    [],
    [],
  );
  assert.equal(result.has('receiving.view'), true);
  assert.equal(result.has('packing.view'), true);
  assert.equal(result.has('admin.view'), false);
});

test('computeEffectivePermissions: added grants beyond role', () => {
  const result = computeEffectivePermissions(
    [{ key: 'viewer', permissions: ['dashboard.view'] }],
    ['orders.create'],
    [],
  );
  assert.equal(result.has('dashboard.view'), true);
  assert.equal(result.has('orders.create'), true);
});

test('computeEffectivePermissions: removed revokes role-granted perms', () => {
  const result = computeEffectivePermissions(
    [{ key: 'receiver', permissions: ['receiving.view', 'receiving.scan_po'] }],
    [],
    ['receiving.scan_po'],
  );
  assert.equal(result.has('receiving.view'), true);
  assert.equal(result.has('receiving.scan_po'), false);
});

test('computeEffectivePermissions: added then removed = net removed', () => {
  const result = computeEffectivePermissions(
    [{ key: 'viewer', permissions: [] }],
    ['orders.create'],
    ['orders.create'],
  );
  assert.equal(result.has('orders.create'), false);
});

test('computeEffectivePermissions: unknown strings in added are dropped silently', () => {
  const result = computeEffectivePermissions(
    [{ key: 'viewer', permissions: ['dashboard.view'] }],
    ['this.is.bogus'],
    [],
  );
  assert.equal(result.has('this.is.bogus' as PermissionString), false);
  assert.equal(result.has('dashboard.view'), true);
});

test('computeEffectivePermissions: empty roles + empty overrides = empty set', () => {
  const result = computeEffectivePermissions([], [], []);
  assert.equal(result.size, 0);
});

test('regression: technician with work_orders.view passes', () => {
  const result = computeEffectivePermissions(
    [{ key: 'technician', permissions: ['tech.view', 'work_orders.view', 'work_orders.claim'] }],
    [],
    [],
  );
  assert.equal(result.has('work_orders.view'), true);
  // Sanity: tech wouldn't have admin permissions
  assert.equal(result.has('admin.view'), false);
});

test('regression: technician missing work_orders.view fails (Sang scenario before the fix)', () => {
  const result = computeEffectivePermissions(
    [{ key: 'technician', permissions: ['tech.view', 'work_orders.claim'] }],
    [],
    [],
  );
  assert.equal(result.has('work_orders.view'), false);
  assert.equal(result.has('work_orders.claim'), true);
});
