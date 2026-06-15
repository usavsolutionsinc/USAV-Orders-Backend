export const meta = {
  name: 'tier0-identity-and-crons',
  description: 'Org-scope the admin staff/role CRUD routes (identity layer) and thread session-less crons via a service-org',
  phases: [{ title: 'Backbone' }, { title: 'Routes' }, { title: 'Verify' }],
}

const backbone = [
  'src/lib/auth/role-store.ts',
  'src/lib/auth/enrollment.ts',
  'src/lib/auth/pin.ts',
  'src/lib/auth/mobile-display-config.ts',
]

const units = [
  { key: 'admin-staff-1', kind: 'identity', files: [
    'src/app/api/admin/staff/route.ts',
    'src/app/api/admin/staff/[id]/route.ts',
    'src/app/api/admin/staff/[id]/detail/route.ts',
    'src/app/api/admin/staff/list/route.ts',
    'src/app/api/admin/staff/update/route.ts',
    'src/app/api/admin/staff/deactivate/route.ts',
    'src/app/api/admin/staff/invite/route.ts',
    'src/app/api/admin/staff/reorder/route.ts',
  ] },
  { key: 'admin-staff-2', kind: 'identity', files: [
    'src/app/api/admin/staff/[id]/permissions/route.ts',
    'src/app/api/admin/staff/[id]/roles/route.ts',
    'src/app/api/admin/staff/[id]/sessions/route.ts',
    'src/app/api/admin/staff/[id]/set-pin/route.ts',
    'src/app/api/admin/staff/[id]/reset-pin/route.ts',
    'src/app/api/admin/staff/[id]/mobile-display-config/route.ts',
    'src/app/api/admin/staff/[id]/enroll-token/route.ts',
    'src/app/api/admin/staff/[id]/passkeys/route.ts',
    'src/app/api/admin/staff/[id]/passkeys/[pid]/route.ts',
  ] },
  { key: 'admin-roles', kind: 'identity', files: [
    'src/app/api/admin/roles/route.ts',
    'src/app/api/admin/roles/[id]/route.ts',
    'src/app/api/admin/roles/[id]/mobile-defaults/route.ts',
    'src/app/api/admin/roles/[id]/duplicate/route.ts',
    'src/app/api/admin/roles/reorder/route.ts',
  ] },
  { key: 'crons-zoho', kind: 'cron', files: [
    'src/app/api/zoho/fulfillment-sync/route.ts',
    'src/app/api/zoho/purchase-orders/sync/route.ts',
    'src/app/api/zoho/purchase-receives/import/route.ts',
    'src/app/api/zoho/purchase-receives/sync/route.ts',
    'src/app/api/zoho/webhooks/route.ts',
  ] },
  { key: 'crons-other', kind: 'cron', files: [
    'src/app/api/ecwid/transfer-orders/route.ts',
    'src/app/api/google-sheets/transfer-orders/route.ts',
    'src/app/api/shipping/track/sync-one/route.ts',
    'src/app/api/webhooks/square/route.ts',
    'src/app/api/webhooks/ups/route.ts',
  ] },
]

const IDENTITY_RULES = `
IDENTITY-LAYER RULES (security-critical — be conservative):
- The \`staff\`, \`staff_passkeys\`, \`staff_sessions\` tables HAVE organization_id. An admin must only see/manage staff in THEIR OWN org. Add \`AND <t>.organization_id = $n\` (= ctx.organizationId / gate.ctx.organizationId) to every read; stamp organization_id on every INSERT; add the org predicate to every UPDATE/DELETE; for [id] routes add an org-ownership 404 gate (a staffId/roleId from another org reads as NOT_FOUND, never mutated).
- \`roles\` is a GLOBAL system table (NO organization_id). Do NOT add an org predicate to \`roles\` itself. For staff↔role ASSIGNMENTS, gate via the \`staff\` parent's org (the staff being assigned must be in this org).
- NEVER change credential-matching or session-establishment logic — these routes are ADMIN CRUD (gated by admin.manage_staff), distinct from /api/auth/* sign-in flows. Do not touch PIN/passkey verification, only the admin management reads/writes.
- New staff created by an admin must be stamped with ctx.organizationId (so an admin can't create staff into another org).
`.trim()

const CRON_RULES = `
SESSION-LESS CRON/WEBHOOK RULES (no ctx.organizationId available):
- These have no session. For the SINGLE-tenant interim, resolve a service org and run the DB work under it so the GUC is set + tables are scoped:
  import { transitionalUsavOrgId } from '@/lib/tenancy/db'  →  const orgId = transitionalUsavOrgId();
  then route the tenant-table reads/writes through tenantQuery(orgId, …)/withTenantTransaction(orgId, …) (or pass orgId into the now-optional-org shared sync modules).
- Add a clear \`// TODO(multi-tenant): resolve org from the webhook payload / per-connection mapping instead of the USAV service org\` at each resolution point. This is the documented 2nd-tenant follow-up — do NOT invent payload parsing now.
- Wrap the disable: an eslint-disable-next-line for the transitionalUsavOrgId call is fine (it's the sanctioned interim). Preserve all existing behavior; only add GUC scoping + the org arg.
`.trim()

const COMMON = `
Imports: import { tenantQuery, withTenantTransaction, transitionalUsavOrgId } from '@/lib/tenancy/db'; import type { OrgId } from '@/lib/tenancy/constants'.
Backbone shared modules are optional-orgId after Phase 1 — pass orgId into their calls. Check docs/tenancy/org-id-coverage.generated.md for whether a table has organization_id before adding an explicit filter (it was just regenerated; the NEEDS-COL column migration is now APPLIED so most tables have it). Do NOT run whole-repo tsc (concurrent edits). Re-read each edited file. Preserve every response shape + status code.
`.trim()

const MODULE_SCHEMA = { type: 'object', additionalProperties: false, properties: { module: { type: 'string' }, changed: { type: 'boolean' }, functionsUpdated: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['module', 'changed', 'functionsUpdated', 'notes'] }
const MIGRATE_SCHEMA = { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } }, leaksClosed: { type: 'array', items: { type: 'string' } }, stoppedFiles: { type: 'array', items: { type: 'string' } }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, notes: { type: 'string' } }, required: ['key', 'filesEdited', 'leaksClosed', 'stoppedFiles', 'confidence', 'notes'] }
const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'issues'] }, missedLeaks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { file: { type: 'string' }, issue: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['file', 'issue', 'severity'] } }, notes: { type: 'string' } }, required: ['key', 'verdict', 'missedLeaks', 'notes'] }

phase('Backbone')
const bb = (await parallel(backbone.map((m) => () =>
  agent(`Make this auth/staff shared module tenant-aware + BACKWARD-COMPATIBLE (optional trailing orgId?: OrgId on each exported function that runs SQL on a staff-scoped tenant table; when present add explicit org predicate / stamp + route through tenantQuery; when omitted keep byte-identical so the sign-in flows that call it without org keep working). \`roles\` is GLOBAL — do not org-filter it. Edit ONLY ${m}. ${IDENTITY_RULES}\n${COMMON}`,
    { label: `bb:${m.split('/').pop()}`, phase: 'Backbone', schema: MODULE_SCHEMA })
))).filter(Boolean)
log(`backbone: ${bb.filter((r) => r && r.changed).length}/${backbone.length} updated`)

phase('Routes')
const results = await pipeline(units,
  (u) => agent(
    `Org-scope EXACTLY these ${u.kind} route files (no others):\n${u.files.map((f) => '  - ' + f).join('\n')}\n\n${u.kind === 'identity' ? IDENTITY_RULES : CRON_RULES}\n${COMMON}\nEdit ONLY the listed files; if a shared module needs changing and isn't a backbone module, record it in stoppedFiles. Return the report.`,
    { label: `mig:${u.key}`, phase: 'Routes', schema: MIGRATE_SCHEMA })
    .then((mig) => ({ u, mig })),
  (prev) => agent(
    `Adversarially review the ${prev.u.kind} tenant-scoping of: ${prev.u.files.join(', ')}. Migrator reported: ${JSON.stringify({ closed: prev.mig && prev.mig.leaksClosed, stopped: prev.mig && prev.mig.stoppedFiles })}. Re-read current contents. For identity: confirm every staff/staff_passkeys/staff_sessions read+write is org-scoped, [id] routes 404 on cross-org, roles left global, and NO credential/sign-in logic was altered. For crons: confirm a service org (transitionalUsavOrgId) scopes the DB work + a multi-tenant TODO is present. Flag remaining cross-tenant leaks or compile risks. Do NOT edit.`,
    { label: `ver:${prev.u.key}`, phase: 'Verify', schema: VERIFY_SCHEMA })
    .then((verify) => ({ unit: prev.u.key, kind: prev.u.kind, files: prev.u.files, mig: prev.mig, verify })),
)

return { backbone: bb, results: results.filter(Boolean) }
