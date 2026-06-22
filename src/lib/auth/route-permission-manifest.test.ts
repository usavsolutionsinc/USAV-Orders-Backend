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
  assert.ok(paths.some((p) => p.includes('product-models/lookup')), 'sourcing.view should gate the brand-neutral lookup façade');
  assert.ok(paths.includes('/api/part-compatibility/route.ts'), 'sourcing.view should gate compatibility list');
  assert.ok(paths.includes('/api/sourcing/saved-searches/route.ts'), 'sourcing.view should gate the saved-searches list');
});

test('regression: sourcing.manage gates the compatibility mutation route', () => {
  const paths = routesGatedBy('sourcing.manage').map((r) => r.path);
  assert.ok(
    paths.includes('/api/part-compatibility/[id]/route.ts'),
    'sourcing.manage should gate compatibility edit/delete',
  );
  assert.ok(
    paths.includes('/api/sourcing/saved-searches/[id]/route.ts'),
    'sourcing.manage should gate saved-search edit/delete',
  );
});

test('regression: photos.view gates the photo library route', () => {
  const paths = routesGatedBy('photos.view').map((r) => r.path);
  assert.ok(paths.includes('/api/photos/library/route.ts'), 'photos.view should gate /api/photos/library');
});

test('regression: photos.share gates share pack creation', () => {
  const paths = routesGatedBy('photos.share').map((r) => r.path);
  assert.ok(paths.includes('/api/photos/share-packs/route.ts'), 'photos.share should gate share pack POST');
});

test('regression: inventory.list_unit gates the per-unit listing route (engine Phase 1.4)', () => {
  // The 'listed' fulfillment-tail seam — marks a serial unit live on a sales
  // channel (src/lib/inventory/markUnitListed.ts), then fires tapWorkflow('listed').
  const paths = routesGatedBy('inventory.list_unit').map((r) => r.path);
  assert.ok(
    paths.includes('/api/serial-units/[id]/list/route.ts'),
    'inventory.list_unit should gate the serial-unit list route',
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

test('regression: stations routes are gated (station builder, ops-studio layer 2)', () => {
  // Reads land on dashboard.view (any signed-in staff renders their stations);
  // the manifest records the first-declared method's permission per file.
  const readPaths = routesGatedBy('dashboard.view').map((r) => r.path);
  assert.ok(readPaths.includes('/api/stations/route.ts'), 'dashboard.view should gate the station definitions read');
  // Draft saves + publish are stations.manage.
  const managePaths = routesGatedBy('stations.manage').map((r) => r.path);
  assert.ok(
    managePaths.includes('/api/stations/publish/route.ts'),
    'stations.manage should gate station publish',
  );
});

test('regression: studio.view gates the Operations Studio graph feed (ST1)', () => {
  const paths = routesGatedBy('studio.view').map((r) => r.path);
  assert.ok(
    paths.includes('/api/studio/graph/route.ts'),
    'studio.view should gate the studio canvas graph read',
  );
});

test('regression: studio.view gates the People lens feed (ST6 / Phase E1)', () => {
  const paths = routesGatedBy('studio.view').map((r) => r.path);
  assert.ok(
    paths.includes('/api/studio/people/route.ts'),
    'studio.view should gate the People-lens staffing-coverage read',
  );
});

test('regression: studio.manage gates the draft/publish lifecycle (ST4)', () => {
  const paths = routesGatedBy('studio.manage').map((r) => r.path);
  assert.ok(
    paths.includes('/api/studio/definitions/draft/route.ts'),
    'studio.manage should gate draft creation',
  );
  assert.ok(
    paths.includes('/api/studio/definitions/[id]/graph/route.ts'),
    'studio.manage should gate draft graph saves',
  );
  assert.ok(
    paths.includes('/api/studio/definitions/[id]/publish/route.ts'),
    'studio.manage should gate publish',
  );
  // Phase C.2 — draft hygiene: discarding a never-published draft is studio.manage.
  assert.ok(
    paths.includes('/api/studio/definitions/[id]/discard/route.ts'),
    'studio.manage should gate draft discard',
  );
});

test('regression: the template library is studio.view to list/preview, studio.manage to import (ST6 / Phase E4)', () => {
  // System-owned default workflow graphs a tenant clones into its own
  // definitions. Listing/previewing a (global) template is studio.view;
  // importing CLONES it into a draft, which is the studio.manage authoring gate.
  const view = routesGatedBy('studio.view').map((r) => r.path);
  assert.ok(
    view.includes('/api/studio/templates/route.ts'),
    'studio.view should gate the template library list',
  );
  assert.ok(
    view.includes('/api/studio/templates/[id]/route.ts'),
    'studio.view should gate the template detail/preview',
  );
  const manage = routesGatedBy('studio.manage').map((r) => r.path);
  assert.ok(
    manage.includes('/api/studio/templates/[id]/import/route.ts'),
    'studio.manage should gate template import (it writes a draft)',
  );
});

test('regression: node-bound station writes are studio.manage (ST5 / Phase D)', () => {
  // The node-scoped station binding (Operations Studio L2). The read
  // (GET .../station) stays studio.view; the manifest records the first-declared
  // method's permission per file, so that GET-first file lands on studio.view —
  // but its PUT (draft write) and the dedicated publish sub-route are
  // studio.manage at runtime.
  const view = routesGatedBy('studio.view').map((r) => r.path);
  assert.ok(
    view.includes('/api/studio/nodes/[id]/station/route.ts'),
    'the node-station read (GET) is gated studio.view',
  );
  const manage = routesGatedBy('studio.manage').map((r) => r.path);
  assert.ok(
    manage.includes('/api/studio/nodes/[id]/station/publish/route.ts'),
    'studio.manage should gate the node-station publish',
  );
  // The write file declares a PUT (defense-in-depth: the route itself gates it
  // studio.manage even though the manifest records the file under the GET).
  const writeFile = routeByPath('/api/studio/nodes/[id]/station/route.ts');
  assert.ok(writeFile);
  assert.ok(writeFile!.methods.includes('PUT'), 'the node-station file exposes a PUT write');
});

test('regression: integrations.amazon gates the Amazon connection routes', () => {
  // Amazon SP-API order import (docs/amazon-sp-api-order-import-plan.md). The
  // OAuth callback is intentionally ungated (state-validated public redirect,
  // like the eBay callback) and is not asserted here.
  const paths = routesGatedBy('integrations.amazon').map((r) => r.path);
  assert.ok(paths.includes('/api/amazon/accounts/route.ts'), 'integrations.amazon should gate amazon accounts');
  assert.ok(paths.includes('/api/amazon/health/route.ts'), 'integrations.amazon should gate amazon health');
  assert.ok(paths.includes('/api/amazon/connect/route.ts'), 'integrations.amazon should gate amazon connect');
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
