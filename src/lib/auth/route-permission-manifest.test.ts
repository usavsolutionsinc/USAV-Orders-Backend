import test from 'node:test';
import assert from 'node:assert/strict';
import {
  manifestSummary,
  permissionsWithRouteCount,
  routeByPath,
  routesGatedBy,
} from './route-permission-manifest';

test('manifest summary has zero ungated writes (the Phase 2e invariant)', () => {
  const s = manifestSummary();
  assert.equal(s.ungatedWrite, 0);
});

test('routesGatedBy returns every route for a known permission', () => {
  const adminManageStaff = routesGatedBy('admin.manage_staff');
  assert.ok(adminManageStaff.length > 0, 'admin.manage_staff should gate at least one route');
  // Staff CRUD endpoint should be in there (Phase 2d hardening).
  assert.ok(
    adminManageStaff.some((r) => r.path === '/api/staff/route.ts'),
    'admin.manage_staff should gate /api/staff/route.ts',
  );
});

test('routesGatedBy with no permission match returns empty array', () => {
  const result = routesGatedBy('this.does.not.exist');
  assert.deepEqual(result, []);
});

test('routeByPath returns null for unknown paths', () => {
  assert.equal(routeByPath('/api/totally-fake/route.ts'), null);
});

test('routeByPath returns the entry for a known route', () => {
  const r = routeByPath('/api/admin/audit/route.ts');
  assert.ok(r);
  assert.equal(r.permission, 'admin.view_logs');
});

test('permissionsWithRouteCount is sorted descending by routeCount', () => {
  const list = permissionsWithRouteCount();
  assert.ok(list.length > 0);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].routeCount >= list[i].routeCount, 'list should be sorted descending');
  }
});

test('regression: work_orders.view gates the assignments routes', () => {
  const gated = routesGatedBy('work_orders.view');
  const paths = gated.map((r) => r.path);
  // Phase 2e added work_orders.view to /api/assignments/sku-search
  assert.ok(paths.some((p) => p.includes('assignments')), 'work_orders.view should gate some assignments route');
});

test('regression: sourcing.view gates the Bose model + compatibility read routes', () => {
  const paths = routesGatedBy('sourcing.view').map((r) => r.path);
  // Bose Sourcing Engine Phase 1 — the manifest records the first-declared
  // method's permission per file, so these read-first routes land on view.
  assert.ok(paths.includes('/api/bose-models/route.ts'), 'sourcing.view should gate /api/bose-models');
  assert.ok(paths.some((p) => p.includes('bose-models/lookup')), 'sourcing.view should gate the compatibility lookup');
  assert.ok(paths.includes('/api/part-compatibility/route.ts'), 'sourcing.view should gate compatibility list');
});

test('regression: sourcing.manage gates the compatibility mutation route', () => {
  const paths = routesGatedBy('sourcing.manage').map((r) => r.path);
  assert.ok(
    paths.includes('/api/part-compatibility/[id]/route.ts'),
    'sourcing.manage should gate compatibility edit/delete',
  );
});

test('regression: handling_unit.view gates the handling-units read routes', () => {
  // Handling units (LPN) — docs/handling-unit-lpn-plan.md. The manifest records
  // the first-declared method's permission per file, so the read-first
  // collection + detail routes land on view.
  const paths = routesGatedBy('handling_unit.view').map((r) => r.path);
  assert.ok(paths.includes('/api/handling-units/route.ts'), 'handling_unit.view should gate the box list');
  assert.ok(paths.includes('/api/handling-units/[id]/route.ts'), 'handling_unit.view should gate the box detail');
});

test('regression: handling_unit.manage gates the assign/unassign mutations', () => {
  const paths = routesGatedBy('handling_unit.manage').map((r) => r.path);
  assert.ok(
    paths.includes('/api/handling-units/[id]/assign/route.ts'),
    'handling_unit.manage should gate unit assignment',
  );
  assert.ok(
    paths.includes('/api/handling-units/[id]/unassign/route.ts'),
    'handling_unit.manage should gate unit removal',
  );
});
