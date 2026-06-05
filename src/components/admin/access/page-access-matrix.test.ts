import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPermissionSource,
  buildPageAccessMatrix,
} from './page-access-matrix';
import type { DetailEnvelope, RoleSlim } from './staff-access-shared';

// A real permission that exists on an APP_SIDEBAR_NAV item, so `inRole` and the
// row builder behave against actual nav data.
const PERM = 'dashboard.view';

function role(perms: string[]): RoleSlim {
  return {
    id: 1, key: 'packer', label: 'Packer', color: '#000',
    position: 0, permissions: perms, is_system: false,
  };
}

function envelope(over: {
  roles?: RoleSlim[];
  added?: string[];
  removed?: string[];
}): DetailEnvelope {
  return {
    staff: {
      id: 1, name: 'Test', role: 'packer', status: 'active', active: true,
      employee_id: null, employee_code: null,
      permissions_added: over.added ?? [],
      permissions_removed: over.removed ?? [],
      mobile_display_config: null, default_home_path: null,
      default_home_path_mobile: null, session_policy: 'default',
      has_pin: false, pin_set_at: null, pin_locked_until: null,
      last_login_at: null, created_at: '2026-01-01',
    },
    passkeys: [], sessions: [], audit: [],
    roles: over.roles ?? [], availableRoles: [],
  };
}

// ─── classifyPermissionSource — the 4 badge states ─────────────────────────

test('classifyPermissionSource: granted by role', () => {
  assert.equal(classifyPermissionSource(true, false, false), 'role');
});

test('classifyPermissionSource: in role but explicitly removed', () => {
  assert.equal(classifyPermissionSource(true, false, true), 'revoked');
});

test('classifyPermissionSource: not in role, granted via override', () => {
  assert.equal(classifyPermissionSource(false, true, false), 'granted');
});

test('classifyPermissionSource: not in role, no override', () => {
  assert.equal(classifyPermissionSource(false, false, false), 'role-denies');
});

// ─── toggle — the reconciliation reducer (former in-JSX click handler) ──────

test('toggle: role-granted page turned OFF → adds to removed', () => {
  const m = buildPageAccessMatrix(envelope({ roles: [role([PERM])] }), false);
  assert.deepEqual(m.toggle(PERM), { add: [], remove: [PERM] });
});

test('toggle: role+removed page turned back ON → clears the removal', () => {
  const m = buildPageAccessMatrix(
    envelope({ roles: [role([PERM])], removed: [PERM] }),
    false,
  );
  assert.deepEqual(m.toggle(PERM), { add: [], remove: [] });
});

test('toggle: non-role page turned ON → adds an override grant', () => {
  const m = buildPageAccessMatrix(envelope({ roles: [role([])] }), false);
  assert.deepEqual(m.toggle(PERM), { add: [PERM], remove: [] });
});

test('toggle: override-granted page turned OFF → drops the grant', () => {
  const m = buildPageAccessMatrix(envelope({ added: [PERM] }), false);
  assert.deepEqual(m.toggle(PERM), { add: [], remove: [] });
});

// ─── effective set + row enabled state ─────────────────────────────────────

test('effectivePermissions = role union + added − removed', () => {
  const m = buildPageAccessMatrix(
    envelope({ roles: [role(['a', 'b'])], added: ['c'], removed: ['b'] }),
    false,
  );
  assert.ok(m.effectivePermissions.has('a'));
  assert.ok(m.effectivePermissions.has('c'));
  assert.ok(!m.effectivePermissions.has('b'));
});

test('admin short-circuits: row enabled + source role even with no roles', () => {
  const m = buildPageAccessMatrix(envelope({ roles: [] }), true);
  const row = m.rows.find((r) => r.permission === PERM);
  assert.ok(row, 'expected a row for ' + PERM);
  assert.equal(row?.enabled, true);
  assert.equal(row?.source, 'role-denies'); // source reflects raw role membership
});

test('row enabled reflects role membership for non-admin', () => {
  const m = buildPageAccessMatrix(envelope({ roles: [role([PERM])] }), false);
  const row = m.rows.find((r) => r.permission === PERM);
  assert.equal(row?.enabled, true);
  assert.equal(row?.source, 'role');
});
