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

test('regression: rma.view/rma.manage gate the RMA routes (not orders.view)', () => {
  // Returns-unification Phase 4 Stage 1 (Gap #8): RMA routes were previously
  // gated by the generic orders.view; migrated to a dedicated rma.* pair so
  // access can be granted independently of general order visibility.
  const viewPaths = routesGatedBy('rma.view').map((r) => r.path);
  const managePaths = routesGatedBy('rma.manage').map((r) => r.path);
  const allRmaPaths = [...viewPaths, ...managePaths];
  assert.ok(allRmaPaths.includes('/api/rma/route.ts'), 'rma.* should gate /api/rma');
  assert.ok(allRmaPaths.includes('/api/rma/[id]/route.ts'), 'rma.* should gate /api/rma/[id]');
  assert.ok(allRmaPaths.includes('/api/rma/by-number/[number]/route.ts'), 'rma.* should gate the by-number lookup');
  assert.ok(managePaths.includes('/api/rma/[id]/close/route.ts'), 'rma.manage should gate close');
  assert.ok(managePaths.includes('/api/rma/[id]/disposition/route.ts'), 'rma.manage should gate disposition');
  assert.ok(managePaths.includes('/api/rma/[id]/mark-received/route.ts'), 'rma.manage should gate mark-received');
  assert.ok(!routesGatedBy('orders.view').some((r) => r.path.startsWith('/api/rma/')), 'no RMA route should still be on orders.view');
});

test('regression: label.manifest.manage gates the label-manifest mutation routes', () => {
  // Serial↔label pairing Phase 3 — manifest create/seal/dissolve + item add/remove
  // are gated by the new label.manifest.manage; the read (GET detail) stays on the
  // shared print.label so anyone who can print can build/scan a kit.
  const managePaths = routesGatedBy('label.manifest.manage').map((r) => r.path);
  assert.ok(managePaths.includes('/api/label-manifests/route.ts'), 'create gated by label.manifest.manage');
  assert.ok(managePaths.includes('/api/label-manifests/[id]/seal/route.ts'), 'seal gated by label.manifest.manage');
  assert.ok(managePaths.includes('/api/label-manifests/[id]/dissolve/route.ts'), 'dissolve gated by label.manifest.manage');
  assert.ok(managePaths.includes('/api/label-manifests/[id]/items/route.ts'), 'add items gated by label.manifest.manage');
  assert.ok(
    managePaths.includes('/api/label-manifests/[id]/items/[serialUnitId]/route.ts'),
    'remove item gated by label.manifest.manage',
  );
  const printPaths = routesGatedBy('print.label').map((r) => r.path);
  assert.ok(printPaths.includes('/api/label-manifests/[id]/route.ts'), 'GET detail gated by print.label');
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

test('regression: receiving.upload_photo gates photo reassignment', () => {
  const paths = routesGatedBy('receiving.upload_photo').map((r) => r.path);
  assert.ok(
    paths.includes('/api/photos/[id]/reassign/route.ts'),
    'receiving.upload_photo should gate photo reassignment',
  );
});

test('regression: photo-label routes are gated (read on view, writes on manage)', () => {
  // Vocabulary list + per-photo label read land on the per-file minimum
  // (photos.view, the GET); the POST/PUT/PATCH/DELETE writes assert photos.manage
  // in-handler. The manage-gated single-label + bulk routes are recorded directly.
  const view = routesGatedBy('photos.view').map((r) => r.path);
  assert.ok(view.includes('/api/photos/labels/route.ts'), 'photos.view should gate the labels vocabulary route');
  assert.ok(view.includes('/api/photos/[id]/labels/route.ts'), 'photos.view should gate the per-photo labels route');

  const manage = routesGatedBy('photos.manage').map((r) => r.path);
  assert.ok(manage.includes('/api/photos/labels/[id]/route.ts'), 'photos.manage should gate single-label edit/delete');
  assert.ok(manage.includes('/api/photos/labels/bulk-apply/route.ts'), 'photos.manage should gate bulk label apply');
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

test('regression: integrations.google_drive gates the Drive connect + health routes', () => {
  // Google Drive photo backup. The OAuth callback is intentionally ungated
  // (encrypted-state public redirect, like the Amazon/eBay callbacks) and is
  // not asserted here.
  const paths = routesGatedBy('integrations.google_drive').map((r) => r.path);
  assert.ok(
    paths.includes('/api/integrations/google-drive/connect/route.ts'),
    'integrations.google_drive should gate the Drive connect route',
  );
  assert.ok(
    paths.includes('/api/integrations/google-drive/health/route.ts'),
    'integrations.google_drive should gate the Drive health route',
  );
});

test('regression: the image-type registry route is permission-gated', () => {
  // The saved-folder system was replaced by the image-type registry. The
  // route file is gated (manifest records the per-file minimum, photos.view for
  // the GET list); the POST that creates a custom type additionally enforces
  // photos.manage in-handler (see /api/photos/image-types/route.ts).
  const route = routeByPath('/api/photos/image-types/route.ts');
  assert.ok(route, 'the image-types route should be in the manifest');
  assert.equal(route.gate, 'withAuth');
  assert.equal(route.permission, 'photos.view');
});

test('regression: shipping.buy_label gates the outbound rate-shop + label-purchase routes (ShipStation)', () => {
  const paths = routesGatedBy('shipping.buy_label').map((r) => r.path);
  assert.ok(paths.includes('/api/outbound/rates/route.ts'), 'shipping.buy_label should gate rate-shop');
  assert.ok(
    paths.includes('/api/outbound/labels/purchase/route.ts'),
    'shipping.buy_label should gate label purchase',
  );
});

test('regression: shipping.void_label gates the label-void route', () => {
  const paths = routesGatedBy('shipping.void_label').map((r) => r.path);
  assert.ok(
    paths.includes('/api/outbound/labels/void/route.ts'),
    'shipping.void_label should gate label void',
  );
});

test('regression: the ShipStation webhook is a signature-verified public route', () => {
  const route = routeByPath('/api/webhooks/shipstation/[token]/route.ts');
  assert.ok(route, 'the ShipStation webhook should be in the manifest');
  assert.equal(route.permission, null);
  assert.ok(route.exemptReason, 'the ShipStation webhook should be exempt (signature-gated)');
});

test('regression: ai.search gates the AI retrieve endpoint (AI search Phase 1)', () => {
  const route = routeByPath('/api/ai/retrieve/route.ts');
  assert.ok(route, 'the AI retrieve route should be in the manifest');
  assert.equal(route.gate, 'withAuth');
  assert.equal(route.permission, 'ai.search');
  const paths = routesGatedBy('ai.search').map((r) => r.path);
  assert.ok(paths.includes('/api/ai/retrieve/route.ts'), 'ai.search should gate /api/ai/retrieve');
});

test('assistant chat route is gated by assistant.chat', () => {
  const paths = routesGatedBy('assistant.chat').map((r) => r.path);
  assert.ok(paths.includes('/api/assistant/chat/route.ts'));
  assert.ok(paths.includes('/api/assistant/mutations/route.ts'));
  assert.ok(paths.includes('/api/mcp/route.ts'));
});

test('assistant mutation revert route is gated by studio.manage', () => {
  const paths = routesGatedBy('studio.manage').map((r) => r.path);
  assert.ok(paths.includes('/api/assistant/mutations/[id]/revert/route.ts'));
});

test('regression: operations.plans.* gates ops-plans routes', () => {
  const viewPaths = routesGatedBy('operations.plans.view').map((r) => r.path);
  const managePaths = routesGatedBy('operations.plans.manage').map((r) => r.path);
  const claimPaths = routesGatedBy('operations.plans.claim').map((r) => r.path);
  assert.ok(viewPaths.includes('/api/ops-plans/route.ts'));
  assert.ok(viewPaths.includes('/api/ops-plans/inbox/route.ts'));
  assert.ok(managePaths.includes('/api/ops-plans/from-template/route.ts'));
  assert.ok(claimPaths.includes('/api/ops-plans/tasks/[taskId]/claim/route.ts'));
});
