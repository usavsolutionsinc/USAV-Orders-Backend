export const meta = {
  name: 'tier0-hotcore-tenant-sweep',
  description: 'Tenant-isolation sweep of the hot-core route surface: backbone modules (optional-orgId) then 82 route units in parallel',
  phases: [
    { title: 'Backbone' },
    { title: 'Routes' },
    { title: 'Verify' },
  ],
}

const backbone = ["src/lib/inventory/events.ts", "src/lib/inventory/state-machine.ts", "src/lib/inventory/allocate.ts", "src/lib/neon/orders-queries.ts", "src/lib/neon/serial-units-queries.ts", "src/lib/inventory/tech-serial.ts", "src/lib/receiving/serial-attach.ts"];
const units = [{"key": "activity", "files": ["src/app/api/activity/feed/route.ts"]}, {"key": "admin", "files": ["src/app/api/admin/features/route.ts", "src/app/api/admin/features/[id]/route.ts", "src/app/api/admin/fix-status/route.ts", "src/app/api/admin/po-gmail/missing-orders/route.ts", "src/app/api/admin/po-gmail/triage/[id]/route.ts", "src/app/api/admin/logs/route.ts", "src/app/api/admin/po-gmail/triage/route.ts", "src/app/api/admin/po-mirror/health/route.ts", "src/app/api/admin/sessions/route.ts"]}, {"key": "ai", "files": ["src/app/api/ai/search/route.ts", "src/app/api/ai/chat-sessions/[sessionId]/messages/route.ts"]}, {"key": "assignments", "files": ["src/app/api/assignments/next/route.ts"]}, {"key": "audit", "files": ["src/app/api/audit/bin/[id]/route.ts", "src/app/api/audit/sku/[sku]/route.ts"]}, {"key": "audit-log", "files": ["src/app/api/audit-log/packing/route.ts", "src/app/api/audit-log/receiving/route.ts", "src/app/api/audit-log/report/route.ts", "src/app/api/audit-log/sku/route.ts", "src/app/api/audit-log/staff/route.ts", "src/app/api/audit-log/staff-directory/route.ts", "src/app/api/audit-log/tech/route.ts"]}, {"key": "bose-models", "files": ["src/app/api/bose-models/route.ts"]}, {"key": "check-tracking", "files": ["src/app/api/check-tracking/route.ts"]}, {"key": "dashboard", "files": ["src/app/api/dashboard/operations/route.ts"]}, {"key": "debug-tracking", "files": ["src/app/api/debug-tracking/route.ts"]}, {"key": "desktop-app", "files": ["src/app/api/desktop-app/release/route.ts"]}, {"key": "ebay", "files": ["src/app/api/ebay/search/route.ts"]}, {"key": "ecwid", "files": ["src/app/api/ecwid/transfer-orders/route.ts", "src/app/api/ecwid/products/search/route.ts", "src/app/api/ecwid/recent-repair-orders/route.ts"]}, {"key": "failure-modes", "files": ["src/app/api/failure-modes/route.ts", "src/app/api/failure-modes/[id]/route.ts"]}, {"key": "favorites", "files": ["src/app/api/favorites/route.ts", "src/app/api/favorites/[id]/route.ts"]}, {"key": "get-title-by-sku", "files": ["src/app/api/get-title-by-sku/route.ts"]}, {"key": "global-search", "files": ["src/app/api/global-search/route.ts"]}, {"key": "google-sheets", "files": ["src/app/api/google-sheets/execute-script/route.ts", "src/app/api/google-sheets/sync-shipstation-orders/route.ts", "src/app/api/google-sheets/transfer-orders/route.ts"]}, {"key": "handling-units", "files": ["src/app/api/handling-units/[id]/route.ts"]}, {"key": "inbox", "files": ["src/app/api/inbox/tech-queue/route.ts"]}, {"key": "inventory", "files": ["src/app/api/inventory/bins-overview/route.ts", "src/app/api/inventory/sku-search/route.ts", "src/app/api/inventory/units/route.ts"]}, {"key": "inventory-events", "files": ["src/app/api/inventory-events/route.ts"]}, {"key": "inventory-photos", "files": ["src/app/api/inventory-photos/route.ts"]}, {"key": "labels", "files": ["src/app/api/labels/recent/route.ts"]}, {"key": "manual-server", "files": ["src/app/api/manual-server/assign/route.ts", "src/app/api/manual-server/by-item/route.ts", "src/app/api/manual-server/unassigned/route.ts"]}, {"key": "manuals", "files": ["src/app/api/manuals/upsert/route.ts", "src/app/api/manuals/recent/route.ts", "src/app/api/manuals/resolve/route.ts"]}, {"key": "nas-dev", "files": ["src/app/api/nas-dev/[[...path]]/route.ts"]}, {"key": "need-to-order", "files": ["src/app/api/need-to-order/[id]/route.ts", "src/app/api/need-to-order/route.ts"]}, {"key": "operations", "files": ["src/app/api/operations/kpi-table/route.ts"]}, {"key": "orders-1", "files": ["src/app/api/orders/[id]/allocate/route.ts", "src/app/api/orders/[id]/release/route.ts", "src/app/api/orders/backfill/ebay/route.ts", "src/app/api/orders/backfill/ecwid/route.ts", "src/app/api/orders/batch/route.ts", "src/app/api/orders/integrity-check/route.ts", "src/app/api/orders/skip/route.ts", "src/app/api/orders/start/route.ts", "src/app/api/orders/[id]/pick-tasks/route.ts"]}, {"key": "orders-2", "files": ["src/app/api/orders/lookup/[orderId]/route.ts", "src/app/api/orders/next/route.ts", "src/app/api/orders/recent/route.ts", "src/app/api/orders/verify/route.ts"]}, {"key": "orders-exceptions", "files": ["src/app/api/orders-exceptions/delete/route.ts", "src/app/api/orders-exceptions/sync/route.ts"]}, {"key": "packing-logs", "files": ["src/app/api/packing-logs/save-photo/route.ts", "src/app/api/packing-logs/history/route.ts"]}, {"key": "part-compatibility", "files": ["src/app/api/part-compatibility/route.ts"]}, {"key": "photos", "files": ["src/app/api/photos/[id]/route.ts"]}, {"key": "pick", "files": ["src/app/api/pick/scan/route.ts", "src/app/api/pick/unscan/route.ts", "src/app/api/pick/queue/route.ts"]}, {"key": "picking", "files": ["src/app/api/picking/session/route.ts", "src/app/api/picking/session/[id]/complete/route.ts", "src/app/api/picking/session/[id]/confirm-pick/route.ts", "src/app/api/picking/session/[id]/short-pick/route.ts"]}, {"key": "product-manuals-1", "files": ["src/app/api/product-manuals/route.ts", "src/app/api/product-manuals/assign/route.ts", "src/app/api/product-manuals/bulk/route.ts", "src/app/api/product-manuals/rename-folder/route.ts", "src/app/api/product-manuals/sync/route.ts", "src/app/api/product-manuals/thumbnail/route.ts", "src/app/api/product-manuals/upload/route.ts", "src/app/api/product-manuals/upsert/route.ts", "src/app/api/product-manuals/by-category/route.ts"]}, {"key": "product-manuals-2", "files": ["src/app/api/product-manuals/search/route.ts"]}, {"key": "products", "files": ["src/app/api/products/[sku]/route.ts"]}, {"key": "quality", "files": ["src/app/api/quality/dashboard/route.ts"]}, {"key": "receiving-1", "files": ["src/app/api/receiving/disposition-suggest/route.ts", "src/app/api/receiving/identify-label/route.ts", "src/app/api/receiving/lines/[id]/move/route.ts", "src/app/api/receiving/lines/[id]/putaway/reverse/route.ts", "src/app/api/receiving/nas-archive-test/route.ts", "src/app/api/receiving/visual-identify/route.ts", "src/app/api/receiving/zendesk-claim/classify/route.ts", "src/app/api/receiving/zendesk-claim/draft/route.ts", "src/app/api/receiving/zendesk-claim/preview/route.ts"]}, {"key": "receiving-2", "files": ["src/app/api/receiving/lines/[id]/timeline/route.ts", "src/app/api/receiving/pending-unboxing/route.ts", "src/app/api/receiving/po/[poId]/route.ts", "src/app/api/receiving/po/list/route.ts"]}, {"key": "receiving-lines-1", "files": ["src/app/api/receiving-lines/[id]/ensure-catalog/route.ts", "src/app/api/receiving-lines/[id]/manuals/route.ts", "src/app/api/receiving-lines/[id]/qc-checks/route.ts", "src/app/api/receiving-lines/incoming/refresh/route.ts", "src/app/api/receiving-lines/incoming/refresh/stream/route.ts", "src/app/api/receiving-lines/incoming/sync-one/route.ts", "src/app/api/receiving-lines/incoming/zoho-refresh/route.ts", "src/app/api/receiving-lines/[id]/testing-bundle/route.ts", "src/app/api/receiving-lines/incoming/delivered-unscanned/route.ts"]}, {"key": "receiving-lines-2", "files": ["src/app/api/receiving-lines/incoming/details/route.ts", "src/app/api/receiving-lines/incoming/summary/route.ts"]}, {"key": "receiving-logs", "files": ["src/app/api/receiving-logs/search/route.ts"]}, {"key": "repair", "files": ["src/app/api/repair/square-payment-link/route.ts", "src/app/api/repair/customers/route.ts", "src/app/api/repair/ecwid-categories/route.ts", "src/app/api/repair/ecwid-products/route.ts"]}, {"key": "repair-service", "files": ["src/app/api/repair-service/out-of-stock/route.ts", "src/app/api/repair-service/document/[id]/route.ts", "src/app/api/repair-service/next/route.ts"]}, {"key": "replenish", "files": ["src/app/api/replenish/bulk-create-po/route.ts"]}, {"key": "replenishment", "files": ["src/app/api/replenishment/tasks/[id]/cancel/route.ts", "src/app/api/replenishment/tasks/[id]/claim/route.ts", "src/app/api/replenishment/tasks/[id]/complete/route.ts"]}, {"key": "reports", "files": ["src/app/api/reports/dead-stock/route.ts", "src/app/api/reports/velocity/route.ts"]}, {"key": "returns", "files": ["src/app/api/returns/undo/route.ts"]}, {"key": "rma", "files": ["src/app/api/rma/route.ts", "src/app/api/rma/[id]/route.ts", "src/app/api/rma/[id]/close/route.ts", "src/app/api/rma/[id]/mark-received/route.ts", "src/app/api/rma/by-number/[number]/route.ts"]}, {"key": "rooms", "files": ["src/app/api/rooms/route.ts", "src/app/api/rooms/[room]/route.ts", "src/app/api/rooms/reorder/route.ts"]}, {"key": "scan", "files": ["src/app/api/scan/history/route.ts"]}, {"key": "serial-units-1", "files": ["src/app/api/serial-units/[id]/allocate/route.ts", "src/app/api/serial-units/[id]/checklist/route.ts", "src/app/api/serial-units/[id]/checklist/bulk/route.ts", "src/app/api/serial-units/[id]/failure-tags/route.ts", "src/app/api/serial-units/[id]/grade/route.ts", "src/app/api/serial-units/[id]/hold/route.ts", "src/app/api/serial-units/[id]/move/route.ts", "src/app/api/serial-units/[id]/release/route.ts", "src/app/api/serial-units/[id]/repairs/route.ts"]}, {"key": "serial-units-2", "files": ["src/app/api/serial-units/[id]/route.ts", "src/app/api/serial-units/[id]/quality/route.ts"]}, {"key": "shipped", "files": ["src/app/api/shipped/submit/route.ts", "src/app/api/shipped/[id]/route.ts", "src/app/api/shipped/debug/route.ts", "src/app/api/shipped/lookup-order/route.ts"]}, {"key": "shipping", "files": ["src/app/api/shipping/track/register/route.ts", "src/app/api/shipping/track/sync-one/route.ts"]}, {"key": "sku", "files": ["src/app/api/sku/[id]/photos/route.ts", "src/app/api/sku/by-tracking/route.ts", "src/app/api/sku/route.ts", "src/app/api/sku/lookup/route.ts", "src/app/api/sku/serials-from-code/route.ts"]}, {"key": "sku-catalog-1", "files": ["src/app/api/sku-catalog/[id]/manuals/route.ts", "src/app/api/sku-catalog/[id]/qc-checks/route.ts", "src/app/api/sku-catalog/pair/route.ts", "src/app/api/sku-catalog/run-migration/route.ts", "src/app/api/sku-catalog/suggest-pairings/route.ts", "src/app/api/sku-catalog/sync-ecwid-products/route.ts", "src/app/api/sku-catalog/sync-ecwid-titles/route.ts", "src/app/api/sku-catalog/pair-suggestions/route.ts", "src/app/api/sku-catalog/pairing-queue/route.ts"]}, {"key": "sku-catalog-2", "files": ["src/app/api/sku-catalog/pairing-queue/count/route.ts", "src/app/api/sku-catalog/search-unmatched/route.ts", "src/app/api/sku-catalog/suggest-for-item/route.ts", "src/app/api/sku-catalog/unpaired/route.ts"]}, {"key": "sku-manager", "files": ["src/app/api/sku-manager/route.ts"]}, {"key": "sku-stock", "files": ["src/app/api/sku-stock/route.ts", "src/app/api/sku-stock/[sku]/bins/route.ts"]}, {"key": "staff-goals", "files": ["src/app/api/staff-goals/me/route.ts"]}, {"key": "staff-todos", "files": ["src/app/api/staff-todos/route.ts"]}, {"key": "support", "files": ["src/app/api/support/overview/route.ts"]}, {"key": "tech", "files": ["src/app/api/tech/add-serial/route.ts", "src/app/api/tech/add-serial-to-last/route.ts", "src/app/api/tech/delete-tracking/route.ts", "src/app/api/tech/test-result/route.ts", "src/app/api/tech/undo-last/route.ts", "src/app/api/tech/update-serials/route.ts", "src/app/api/tech/logs/route.ts", "src/app/api/tech/orders-without-manual/route.ts"]}, {"key": "tech-logs", "files": ["src/app/api/tech-logs/search/route.ts"]}, {"key": "testing", "files": ["src/app/api/testing/recent/route.ts"]}, {"key": "tracking-exceptions", "files": ["src/app/api/tracking-exceptions/[id]/route.ts", "src/app/api/tracking-exceptions/route.ts"]}, {"key": "transfers", "files": ["src/app/api/transfers/route.ts"]}, {"key": "units", "files": ["src/app/api/units/next-id/route.ts", "src/app/api/units/resolve-id/route.ts"]}, {"key": "update-sku-location", "files": ["src/app/api/update-sku-location/route.ts"]}, {"key": "vision-config", "files": ["src/app/api/vision-config/route.ts"]}, {"key": "walk-in", "files": ["src/app/api/walk-in/customers/route.ts", "src/app/api/walk-in/orders/route.ts", "src/app/api/walk-in/catalog/route.ts", "src/app/api/walk-in/status/route.ts"]}, {"key": "warehouses", "files": ["src/app/api/warehouses/route.ts"]}, {"key": "warranty", "files": ["src/app/api/warranty/quotes/[id]/route.ts", "src/app/api/warranty/reports/export/route.ts"]}, {"key": "webhooks", "files": ["src/app/api/webhooks/square/route.ts", "src/app/api/webhooks/ups/route.ts", "src/app/api/webhooks/zoho/orders/route.ts"]}, {"key": "workflow", "files": ["src/app/api/workflow/flow-audit/route.ts"]}, {"key": "zoho-1", "files": ["src/app/api/zoho/find-po/route.ts", "src/app/api/zoho/fulfillment-sync/route.ts", "src/app/api/zoho/purchase-orders/sync/route.ts", "src/app/api/zoho/purchase-receives/import/route.ts", "src/app/api/zoho/purchase-receives/sync/route.ts", "src/app/api/zoho/webhooks/route.ts", "src/app/api/zoho/items/[id]/image/route.ts", "src/app/api/zoho/oauth/authorize/route.ts", "src/app/api/zoho/oauth/callback/route.ts"]}, {"key": "zoho-2", "files": ["src/app/api/zoho/purchase-orders/route.ts", "src/app/api/zoho/purchase-receives/route.ts", "src/app/api/zoho/warehouses/route.ts"]}];

const PATTERN = `
TENANT-ISOLATION MIGRATION PATTERN (apply exactly):
Imports: import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db'; (and import type { OrgId } from '@/lib/tenancy/constants' if a helper needs the type).
orgId source:
 - withAuth(async (req, ctx) => …, { permission }) → ctx.organizationId
 - requireRoutePerm(req, perm): after \`if (gate.denied) return gate.denied;\` → const orgId = gate.ctx.organizationId
 - server component page: const user = await requirePermission(...) → user.organizationId
 - server action / no ctx: const user = await getCurrentUser(); if (!user) return; → user.organizationId
Rules:
 1. READS on a tenant table → run via tenantQuery(orgId, sql, params) + add explicit AND <t>.organization_id = $n. Convert raw pool.query → tenantQuery.
 2. WRITES → withTenantTransaction(orgId, async (client)=>{…}); stamp organization_id on INSERTs; add AND organization_id = $n to UPDATE/DELETE WHERE. A single write may use tenantQuery.
 3. JOINS on STRING keys (sku, fnsku, serial, normalized_serial, barcode, order_number_norm, tracking) collide across tenants → MUST add AND <t>.organization_id = <other>.organization_id. Joins on integer surrogate PKs (staff.id, *.id) are safe bare.
 4. CHILD-table INSERT whose parent has org → derive via subquery (SELECT organization_id FROM <parent> WHERE id=<fk>) OR pass threaded orgId.
 5. [id]/verb writes → org-ownership precheck → 404 on mismatch (never 403). READ and WRITE sides BOTH gated.
 6. A table with NO organization_id column (check docs/tenancy/org-id-coverage.generated.md — ✅ in the has-column position) → scope via its parent's org; if no parent, GUC-wrap only (tenantQuery) and note it (NEEDS-COL — plumbing, not full isolation).
 7. Keep idempotency-helper pool args (getApiIdempotencyResponse/saveApiIdempotencyResponse take raw pool) — keep \`import pool from '@/lib/db'\` if only those use it.
 8. The backbone shared modules are ALREADY optional-orgId after Phase 1 — just pass orgId into their calls (e.g. transition({...}, orgId), recordInventoryEvent({...}, orgId)). Check the function's current signature before passing.
Exemplars: src/app/api/reason-codes/route.ts, src/app/api/local-pickup-orders/route.ts, src/lib/inventory/cycle-count.ts.
`.trim()

const MODULE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    module: { type: 'string' },
    changed: { type: 'boolean' },
    functionsUpdated: { type: 'array', items: { type: 'string' } },
    pattern: { type: 'string', description: 'how org is threaded: optional-orgId param + tenantQuery-when-present, etc.' },
    notes: { type: 'string' },
  },
  required: ['module', 'changed', 'functionsUpdated', 'pattern', 'notes'],
}
const MIGRATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    key: { type: 'string' },
    filesEdited: { type: 'array', items: { type: 'string' } },
    leaksClosed: { type: 'array', items: { type: 'string' } },
    stoppedFiles: { type: 'array', items: { type: 'string' }, description: 'shared modules you needed but did NOT edit (not in your fileset)' },
    needsColTables: { type: 'array', items: { type: 'string' }, description: 'in-scope tables with no org column you could only GUC-wrap' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' },
  },
  required: ['key', 'filesEdited', 'leaksClosed', 'stoppedFiles', 'needsColTables', 'confidence', 'notes'],
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    key: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'issues'] },
    missedLeaks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { file: { type: 'string' }, issue: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['file', 'issue', 'severity'] } },
    notes: { type: 'string' },
  },
  required: ['key', 'verdict', 'missedLeaks', 'notes'],
}

// ── Phase 1: Backbone modules → optional-orgId (BARRIER) ─────────────────────
phase('Backbone')
const backboneResults = (await parallel(backbone.map((m) => () =>
  agent(
    `Make this shared backbone module tenant-aware in a BACKWARD-COMPATIBLE way so the route sweep can thread org through it. Edit ONLY this file: ${m}

For EACH exported function that runs SQL against a tenant table:
 - add an OPTIONAL trailing parameter \`orgId?: OrgId\` (import type { OrgId } from '@/lib/tenancy/constants').
 - when orgId is provided, run the query via tenantQuery/withTenantConnection/withTenantTransaction (from '@/lib/tenancy/db') AND add an explicit \`AND <t>.organization_id = $n\` to reads / stamp it on writes / align string-key joins.
 - when orgId is OMITTED, keep the EXISTING raw pool.query behavior BYTE-IDENTICAL (so the many existing callers that don't yet pass org keep compiling and behaving exactly as today). Do NOT make orgId required. Do NOT change any caller.
 - functions that take an existing transaction client (executor pattern) — add optional orgId and, when present, set the GUC on that client via \`SELECT set_config('app.current_org',$1,true)\` before the writes, or add the explicit org predicate.
${PATTERN}

This is the critical shared core — be conservative and exact; preserve all behavior, comments, and signatures (only ADD an optional trailing param). Do NOT run whole-repo tsc (other agents edit concurrently). Re-read your edits to confirm. Return the structured report.`,
    { label: `backbone:${m.split('/').pop()}`, phase: 'Backbone', schema: MODULE_SCHEMA },
  ),
))).filter(Boolean)

const backboneList = backbone.join(', ')
log(`Backbone done: ${backboneResults.filter((r) => r && r.changed).length}/${backbone.length} modules updated`)

// ── Phase 2 + 3: Routes (parallel units) → adversarial verify (pipeline) ─────
phase('Routes')
const results = await pipeline(
  units,
  (u) => agent(
    `Apply the tenant-isolation migration to EXACTLY these route files (and NO others):
${u.files.map((f) => '  - ' + f).join('\n')}

Backbone shared modules were just made optional-orgId in Phase 1 — when your routes call them, pass the route's orgId: ${backboneList}

${PATTERN}

HARD CONSTRAINTS:
 - Edit ONLY the files listed above. If a route needs a shared module changed that is NOT a backbone module and NOT in your list, do NOT edit it — record it in stoppedFiles and migrate the route's own inline SQL + backbone calls.
 - Do NOT touch auth/session establishment logic (PIN/passkey/signin lookups) — those resolve org, they don't filter by it.
 - Check org-column presence per table in docs/tenancy/org-id-coverage.generated.md before adding an explicit filter; if a table has no org column, scope via parent or GUC-wrap only and list it in needsColTables.
 - Preserve every response shape, status code, comment, and behavior — add ONLY org scoping. Do NOT run whole-repo tsc (concurrent edits). Re-read each edited file to confirm: every read org-filtered + GUC-wrapped, every write org-stamped, string joins aligned, [id] writes 404-gated.

Return the structured report.`,
    { label: `migrate:${u.key}`, phase: 'Routes', schema: MIGRATE_SCHEMA },
  ),
  (mig, u) => agent(
    `Adversarially review a tenant-isolation migration of these route files: ${u.files.join(', ')}.
Migrator reported: ${JSON.stringify({ leaksClosed: (mig && mig.leaksClosed) || [], stopped: (mig && mig.stoppedFiles) || [], needsCol: (mig && mig.needsColTables) || [], conf: mig && mig.confidence })}
Re-read each file's CURRENT contents and find REMAINING cross-tenant defects:
 - SELECT/UPDATE/DELETE on a tenant table (that HAS an org column) with no organization_id predicate and not wrapped in tenantQuery/withTenant*;
 - INSERT not stamping organization_id (NULL-org write-bug) when the table has the column;
 - string-key JOIN (sku/fnsku/serial/normalized_serial/barcode/tracking/order_number_norm) without an org alignment;
 - [id]/verb write missing the org-ownership 404 gate;
 - a backbone-call that should pass orgId but doesn't;
 - any obvious type/compile error introduced (wrong arg count to a backbone fn, missing import).
Use grep/read freely; do NOT edit. verdict 'pass' only if no real defect; else list missedLeaks (file/issue/severity).`,
    { label: `verify:${u.key}`, phase: 'Verify', schema: VERIFY_SCHEMA },
  ).then((verify) => ({ unit: u.key, files: u.files, mig, verify })),
)

return {
  backbone: backboneResults,
  unitsCount: units.length,
  routeFiles: units.reduce((n, u) => n + u.files.length, 0),
  results: results.filter(Boolean),
}
