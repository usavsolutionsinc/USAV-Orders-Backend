export const meta = {
  name: 'tier0-tenant-isolation-sweep',
  description: 'Parallel tenant-isolation (RLS GUC) migration of cold, self-contained API route domains',
  phases: [
    { title: 'Scout' },
    { title: 'Migrate' },
    { title: 'Verify' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// The proven migration pattern (from docs/tier0-resume-handoff.md §6). Embedded
// verbatim into every migrator so each agent applies the identical house style.
// ─────────────────────────────────────────────────────────────────────────────
const PATTERN = `
TENANT-ISOLATION MIGRATION PATTERN (apply exactly; do not invent variations):

Imports: \`import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';\`
(and \`import type { OrgId } from '@/lib/tenancy/constants';\` when a helper needs the type).

Getting orgId:
- Routes using \`withAuth(async (req, ctx) => …, { permission })\`: use \`ctx.organizationId\`.
- Routes using \`requireRoutePerm(req, perm)\`: after \`if (gate.denied) return gate.denied;\` use \`gate.ctx.organizationId\` (capture \`const orgId = gate.ctx.organizationId;\`).
- Server-component pages: \`const user = await requirePermission(...)\` returns CurrentUser → \`user.organizationId\`.
- Server actions (no ctx): \`const user = await getCurrentUser(); if (!user) return;\` → \`user.organizationId\`.

Rules:
1. READS → run via \`tenantQuery(orgId, sql, params)\` and add an explicit \`AND <t>.organization_id = $n\` predicate. Convert raw \`pool.query(...)\` to \`tenantQuery(orgId, ...)\`.
2. WRITES → run via \`withTenantTransaction(orgId, async (client) => { ... })\`; stamp \`organization_id\` on INSERTs and add \`AND organization_id = $n\` to UPDATE/DELETE WHERE clauses. A single write can use \`tenantQuery\`.
3. SHARED / SESSION-LESS helpers (a *-queries.ts function with callers OUTSIDE your assigned fileset, e.g. cron/Zoho/sync): give it an OPTIONAL \`orgId?: OrgId\` and keep byte-identical behavior when omitted (so external callers do not break). NEVER change a REQUIRED signature an out-of-fileset caller depends on. If unsure whether a caller is external, grep for callers.
4. JOINS on STRING keys (sku, fnsku, serial, order_number_norm, barcode) collide across tenants → MUST add an org-equality predicate, e.g. \`JOIN sku_catalog sc ON sc.sku = x.sku AND sc.organization_id = x.organization_id\`. Joins on globally-unique integer PKs (staff.id, *_shipments.id, locations.id) are safe bare.
5. CHILD-table INSERTs whose parent carries org → derive org via subquery \`(SELECT organization_id FROM <parent> WHERE id = <fk>)\` OR pass the threaded orgId. (This is the write-bug class: a NULL org on a GUC-default column throws.)
6. \`[id]\`/verb routes → org-ownership precheck → 404 on mismatch (never 403). READ and WRITE sides must BOTH be gated.
7. A table WITHOUT its own organization_id column → scope it via its parent table's org (e.g. local_pickup_items scoped via receiving.organization_id). Confirm column presence in docs/tenancy/org-id-coverage.generated.md (a ✅ in the has-column column).
8. Do NOT touch the idempotency helpers' \`pool\` arg (getApiIdempotencyResponse/saveApiIdempotencyResponse take the raw pool by design) — keep the \`import pool from '@/lib/db'\` if only those use it.

Exemplars already in the tree to mirror: src/app/api/reason-codes/route.ts, src/app/api/local-pickup-orders/route.ts, src/app/api/local-pickup-orders/[id]/route.ts, src/lib/inventory/cycle-count.ts.
`.trim()

// Candidate domain clusters (by owning table set). Scouts find the actual route
// files + shared modules and decide migrate/skip. Tables shared with the giant
// hot domains (orders/serial_units/receiving/sku/staff/fba/inventory_events) are
// deliberately NOT seeded — those are the user's hot zone.
// ROUND 2 (2026-06-14b): the remaining COLD, self-contained domains after the
// first sweep landed 9. The user is actively editing the core (orders/sku/
// receiving/serial_units/tech/mobile) — scouts MUST drop anything hot or whose
// shared module is imported by those hot domains.
const CLUSTERS = [
  { key: 'printer-profiles', tables: ['printer_profiles'], hint: 'printer profile admin route(s)' },
  { key: 'payroll-settings', tables: ['payroll_settings'], hint: 'payroll settings route' },
  { key: 'pending-skus', tables: ['pending_skus'], hint: 'pending skus route (skip if it shares a module with sku/catalog hot work)' },
  { key: 'item-stock-cache', tables: ['item_stock_cache'], hint: 'item stock cache route/module (skip if shared with sku_stock hot work)' },
  { key: 'failure-modes', tables: ['failure_modes'], hint: 'failure-mode taxonomy route (repair/sourcing)' },
  { key: 'kpi-rollups', tables: ['operations_kpi_rollups_daily', 'operations_kpi_rollups_hourly'], hint: 'operations KPI rollup read/cron routes' },
  { key: 'auth-audit', tables: ['auth_audit'], hint: 'auth audit log read routes (NOT the auth write path)' },
  { key: 'part-acquisitions', tables: ['part_acquisitions'], hint: 'sourcing part-acquisition route (skip if shares sourcing-scan job with hot work)' },
  { key: 'sync-cursors', tables: ['sync_cursors'], hint: 'src/lib/sync-cursors.ts shared module — use OPTIONAL-orgId so the zoho/square/receiving callers keep compiling; only migrate if you can do it backward-compatibly' },
  { key: 'mobile-scan-events', tables: ['mobile_scan_events'], hint: 'mobile scan-event API route(s) — skip if the route file or its module is in the hot mobile set' },
  { key: 'email-delivery-signals', tables: ['email_delivery_signals'], hint: 'email delivery signal route (skip if receiving-adjacent + hot)' },
  { key: 'sku-pairing-audit', tables: ['sku_pairing_audit'], hint: 'sku pairing audit route — skip if pairing-queries.ts is shared with hot sku/products pairing work' },
  { key: 'unit-quality', tables: ['unit_quality_scores', 'unit_failure_tags'], hint: 'unit quality/failure-tag routes — skip if they share serial_units/tech hot modules' },
]

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string' },
    routeFiles: { type: 'array', items: { type: 'string' }, description: 'absolute or repo-relative paths of route.ts files this domain owns and that need migrating' },
    sharedSqlModules: { type: 'array', items: { type: 'string' }, description: 'paths under src/lib/** that hold the SQL these routes use for the domain tables and would need editing' },
    tablesTouched: { type: 'array', items: { type: 'string' } },
    tablesMissingOrgId: { type: 'array', items: { type: 'string' }, description: 'tables this domain writes/reads that do NOT have an organization_id column (must be scoped via parent)' },
    anyFileHot: { type: 'boolean', description: 'true if ANY routeFile or sharedSqlModule was modified in the last 180 minutes (run find -mmin -180)' },
    hotFiles: { type: 'array', items: { type: 'string' } },
    selfContained: { type: 'boolean', description: 'true if every shared module is either owned only by this domain OR can be made backward-compatible with optional orgId' },
    recommendation: { type: 'string', enum: ['migrate', 'skip'] },
    reason: { type: 'string' },
  },
  required: ['key', 'routeFiles', 'sharedSqlModules', 'tablesTouched', 'tablesMissingOrgId', 'anyFileHot', 'hotFiles', 'selfContained', 'recommendation', 'reason'],
}

const MIGRATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string' },
    filesEdited: { type: 'array', items: { type: 'string' } },
    routesMadeGucSafe: { type: 'array', items: { type: 'string' } },
    leaksClosed: { type: 'array', items: { type: 'string' }, description: 'short description of each cross-tenant leak closed (missing org filter, unaligned string join, IDOR, NULL-org write, etc.)' },
    stoppedFiles: { type: 'array', items: { type: 'string' }, description: 'files you needed to edit but were NOT in your assigned fileset — you did NOT edit them; list for the integrator' },
    selfReviewNotes: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['key', 'filesEdited', 'routesMadeGucSafe', 'leaksClosed', 'stoppedFiles', 'selfReviewNotes', 'confidence'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'issues'] },
    missedLeaks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { file: { type: 'string' }, issue: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['file', 'issue', 'severity'] } },
    notes: { type: 'string' },
  },
  required: ['key', 'verdict', 'missedLeaks', 'notes'],
}

// ── Phase 1: Scout (parallel, read-only) ─────────────────────────────────────
phase('Scout')
const scoutResults = (await parallel(CLUSTERS.map((c) => () =>
  agent(
    `You are scouting a candidate domain for a tenant-isolation (Postgres RLS GUC) migration in a Next.js App Router repo (cwd is the repo root).

DOMAIN key: ${c.key}
Owning tables: ${c.tables.join(', ')}
Where to look: ${c.hint}

Your job is READ-ONLY analysis. Determine precisely:
1. routeFiles: the \`src/app/api/**/route.ts\` files that touch these tables and still leak (no org filter / no GUC). Use grep, e.g. \`grep -rl '<table>' src/app/api --include route.ts\`. Cross-check against docs/tenancy/route-scoping-audit.generated.md (the reverse index lists routes per table with ⛔=not-GUC-safe, ✅=done). Only include ⛔ routes.
2. sharedSqlModules: any file under src/lib/** that those routes import AND that contains the SQL for these tables (e.g. a *-queries.ts). Open the routes to see their imports.
3. tablesTouched + tablesMissingOrgId: which touched tables lack an organization_id column. Check docs/tenancy/org-id-coverage.generated.md — a table row has a ✅ in the has-column position when it HAS organization_id.
4. anyFileHot: run \`find <each route + module> -mmin -180\` (or \`find src/app/api/<dir> -name route.ts -mmin -180\`). If ANY is hot (edited in last 180 min), set anyFileHot=true and list hotFiles. Hot files are off-limits.
5. selfContained: for each sharedSqlModule, grep its function callers across src/ — if a function has callers OUTSIDE this domain's routeFiles, it can still be migrated ONLY via the OPTIONAL-orgId pattern. If a shared module is so cross-cutting (e.g. orders-queries.ts, sku-stock-queries.ts, inventory/state-machine.ts, inventory/events.ts) that touching it risks the user's hot work, set selfContained=false and recommend skip.
6. recommendation: 'migrate' if the domain is cold (no hot files), self-contained, and has a bounded fileset; else 'skip' with a clear reason.

Do NOT edit anything. Return the structured result. Be precise with file paths (repo-relative, e.g. src/app/api/locations/route.ts).`,
    { label: `scout:${c.key}`, phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'Explore' },
  ),
))).filter(Boolean)

log(`Scouts done: ${scoutResults.length}/${CLUSTERS.length} returned`)

// ── Partition: keep migratable + cold; merge any units sharing a file (union-find) ──
const candidates = scoutResults.filter(
  (s) => s.recommendation === 'migrate' && !s.anyFileHot && s.selfContained && (s.routeFiles.length + s.sharedSqlModules.length) > 0,
)
const dropped = scoutResults.filter((s) => !candidates.includes(s))
for (const d of dropped) log(`SKIP ${d.key}: ${d.reason}`)

const norm = (p) => p.replace(/^\.?\//, '').trim()
const filesOf = (s) => [...new Set([...(s.routeFiles || []), ...(s.sharedSqlModules || [])].map(norm))]

// union-find over candidate indices, joined when they share any file
const parent = candidates.map((_, i) => i)
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
const union = (a, b) => { parent[find(a)] = find(b) }
const fileOwner = new Map()
candidates.forEach((s, i) => {
  for (const f of filesOf(s)) {
    if (fileOwner.has(f)) union(i, fileOwner.get(f))
    else fileOwner.set(f, i)
  }
})

const groups = new Map()
candidates.forEach((s, i) => {
  const root = find(i)
  if (!groups.has(root)) groups.set(root, [])
  groups.get(root).push(s)
})

const units = [...groups.values()].map((members) => {
  const files = [...new Set(members.flatMap(filesOf))]
  const tablesMissingOrgId = [...new Set(members.flatMap((m) => m.tablesMissingOrgId || []))]
  const tablesTouched = [...new Set(members.flatMap((m) => m.tablesTouched || []))]
  return { key: members.map((m) => m.key).join('+'), files, tablesMissingOrgId, tablesTouched, memberCount: members.length }
})

// Safety assertion: every file belongs to exactly one unit (pairwise-disjoint).
const seen = new Map()
for (const u of units) for (const f of u.files) {
  if (seen.has(f)) { log(`FATAL: file ${f} in two units (${seen.get(f)} & ${u.key}) — aborting to avoid corruption`); throw new Error('partition not disjoint') }
  seen.set(f, u.key)
}
log(`Partition: ${units.length} disjoint units → ${units.map((u) => `${u.key}(${u.files.length}f)`).join(', ')}`)

// ── Phase 2 + 3: Migrate (parallel, disjoint files) → adversarial Verify (pipeline) ──
phase('Migrate')
const results = await pipeline(
  units,
  // Stage 1: migrate
  (u) => agent(
    `Apply the tenant-isolation migration to EXACTLY these files (and no others):
${u.files.map((f) => `  - ${f}`).join('\n')}

Tables in scope: ${u.tablesTouched.join(', ') || '(see the files)'}
${u.tablesMissingOrgId.length ? `Tables WITHOUT an organization_id column (scope these via their parent's org, do NOT add a column): ${u.tablesMissingOrgId.join(', ')}` : 'All in-scope tables have an organization_id column.'}

${PATTERN}

HARD CONSTRAINTS:
- Edit ONLY the files listed above. If you discover you must edit a file NOT in the list (e.g. a shared module with the SQL), do NOT edit it — record it in stoppedFiles and migrate what you safely can in your own files.
- For a shared *-queries.ts in your list: before changing any function signature, grep for ALL its callers across src/. If any caller is outside your file list, use the OPTIONAL-orgId pattern (orgId?: OrgId) so those callers keep compiling. Thread the orgId from the routes you own.
- Verify org-column presence for each table via docs/tenancy/org-id-coverage.generated.md before adding an explicit filter; if a table lacks the column, scope via parent.
- Do NOT run a whole-repo \`tsc\` (other agents are editing concurrently — it will show unrelated errors). You MAY read files and reason about types. Keep edits minimal and surgical; preserve all existing behavior, comments, and response shapes.
- After editing, re-read your changed files to confirm correctness (org filter on every read, org stamp on every write, string joins aligned, [id] writes 404-gated).

Return the structured report.`,
    { label: `migrate:${u.key}`, phase: 'Migrate', schema: MIGRATE_SCHEMA },
  ),
  // Stage 2: adversarial verify (runs as soon as this unit's migration completes)
  (mig, u) => agent(
    `Adversarially review a tenant-isolation migration. Files: ${u.files.join(', ')}.
The migrator reported: ${JSON.stringify({ leaksClosed: mig?.leaksClosed, stoppedFiles: mig?.stoppedFiles, confidence: mig?.confidence })}

Re-read each file's current contents and hunt for REMAINING cross-tenant defects the migrator may have missed:
- a SELECT/UPDATE/DELETE on an in-scope tenant table with NO \`organization_id\` predicate and NOT wrapped in tenantQuery/withTenantConnection;
- an INSERT that does not stamp organization_id (NULL-org write-bug);
- a JOIN on a string key (sku/fnsku/serial/barcode/order_number_norm) without an \`AND <t>.organization_id = …\` alignment;
- an \`[id]\`/verb write missing the org-ownership 404 gate;
- a shared-module function whose REQUIRED signature changed while an out-of-fileset caller still calls it (would break the build).
Use grep/read freely. Do NOT edit files. Report verdict 'pass' only if you find no real defect; otherwise list missedLeaks with file + issue + severity.`,
    { label: `verify:${u.key}`, phase: 'Verify', schema: VERIFY_SCHEMA },
  ).then((verify) => ({ unit: u.key, files: u.files, mig, verify })),
)

return {
  unitsMigrated: units.map((u) => u.key),
  dropped: dropped.map((d) => ({ key: d.key, reason: d.reason })),
  results: results.filter(Boolean),
}
