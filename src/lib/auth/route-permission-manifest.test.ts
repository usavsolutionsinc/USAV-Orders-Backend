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
