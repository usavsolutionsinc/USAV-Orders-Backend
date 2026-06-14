`UPSTASH_REDIS_*` is not present in any local `.env` file — meaning it must be set in Vercel (or not at all). That's a finding worth flagging. I now have everything. Producing the spec.

---

# Phase D3 / D4 / D5 + B4 — Per-file Tenancy Remediation Specs

Ground-truth confirmed against the live files. The recurring root issue across all five targets: **process-wide singletons and env-fallback shortcuts that silently assume "the one tenant is USAV."** Each is fine today (single tenant) and becomes a cross-tenant data-leak the moment org #2 onboards.

---

## D3 — `src/lib/po-gmail/client.ts` (singleton OAuth token, no org column)

### Finding
The `google_oauth_tokens` table is queried with `WHERE provider='po_gmail' LIMIT 1` in five places (`loadActiveToken`, `markNeedsReconnect`, `clearNeedsReconnect`, `getAccessToken`'s UPDATE-by-id, `getConnectedEmail`). There is exactly one PO-mailbox row and it is implicitly USAV's. The table has **no `organization_id` column** (it is not in `coverage.generated.json`). Callers are all under `src/app/api/admin/po-gmail/*` and run through `withAuth` — `oauth-callback` already has `ctx`, but `reconcile`/`connect` discard it. `src/lib/po-gmail/messages.ts` also calls `poGmailFetch`.

### Decision (two-stage)
Full per-org Gmail connect is a future feature; for the burn-down phase the cheap, correct move is a **hard guard**: a non-USAV org must never touch the singleton USAV mailbox. Add an `orgId` parameter that defaults to `USAV_ORG_ID` (transitional) and throw if a different org is passed. This keeps today's single call sites working while making a cross-tenant call structurally impossible.

### Code — `src/lib/po-gmail/client.ts`

Add imports + a guard helper at the top:

```ts
import pool from '@/lib/db';
import { USAV_ORG_ID, type OrgId } from '@/lib/tenancy/constants';

// ... existing constants ...

/**
 * TRANSITIONAL: the PO mailbox is a single global row (no organization_id
 * column yet). Until per-org Gmail connect ships, only USAV may use it. Any
 * other tenant calling these helpers is a bug — fail loud instead of silently
 * reading/refreshing USAV's mailbox token under another org's request.
 */
function assertUsavMailbox(orgId: OrgId): void {
  if (orgId !== USAV_ORG_ID) {
    throw new PoGmailNotConnectedError(
      'PO mailbox is not configured for this organization.',
      false,
    );
  }
}
```

Thread `orgId` through the public surface (defaulted, so existing callers compile unchanged):

```ts
export async function getAccessToken(orgId: OrgId = USAV_ORG_ID): Promise<string> {
  assertUsavMailbox(orgId);
  const row = await loadActiveToken();
  // ... unchanged body ...
}

export async function poGmailFetch(
  url: string,
  init: RequestInit = {},
  orgId: OrgId = USAV_ORG_ID,
): Promise<Response> {
  const token = await getAccessToken(orgId);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function getConnectedEmail(orgId: OrgId = USAV_ORG_ID): Promise<string | null> {
  assertUsavMailbox(orgId);
  const { rows } = await pool.query<{ account_email: string | null }>(
    `SELECT account_email FROM google_oauth_tokens WHERE provider = $1 LIMIT 1`,
    [PROVIDER],
  );
  return rows[0]?.account_email ?? null;
}
```

### Call-site change (the one route that has org context)
`src/app/api/admin/po-gmail/oauth-callback/route.ts` already destructures `ctx`. Pass `ctx.organizationId` into whatever store helper persists the token, and `reconcile`/`connect` should pass `ctx.organizationId` to `poGmailFetch`/`getAccessToken`. Because the default is `USAV_ORG_ID`, this is forward-compatible: when the column lands, you flip the helpers to filter `WHERE organization_id = $1` and the guard becomes a real lookup.

### Future column (do NOT apply this phase — note it as the real fix)
When per-org Gmail connect ships, add to a new migration following the established idempotent pattern:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='google_oauth_tokens' AND column_name='organization_id') THEN
    ALTER TABLE google_oauth_tokens ADD COLUMN organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
    ALTER TABLE google_oauth_tokens ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting('app.current_org',true),'')::uuid;
    ALTER TABLE google_oauth_tokens ADD CONSTRAINT google_oauth_tokens_org_fk
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
    CREATE UNIQUE INDEX google_oauth_tokens_org_provider_uk ON google_oauth_tokens (organization_id, provider);
  END IF;
END $$;
```
Then change every `WHERE provider = $1` to `WHERE organization_id = $1 AND provider = $2` and have `assertUsavMailbox` become the lookup itself.

---

## D4 — Caches: org-keyed or proven global-safe

### (a) `src/lib/cache.ts` — **client-side, proven global-safe; no change**
This is a browser module (`window.dispatchEvent`, custom events, `useCache` hook). The `store` singleton lives in the user's tab; a tab is already scoped to one logged-in user → one org. There is no cross-tenant sharing possible in a per-tab JS heap. **Verdict: global-safe by construction.** Add a one-line doc note so a future reader doesn't "fix" it:

```ts
// SAFETY: This store is per-browser-tab (client-only — see window usage below).
// A tab is bound to one signed-in user → one org, so keys need NOT be org-scoped.
// Do NOT import this in a route handler / server module.
const store: CacheStore = {};
```

If you want belt-and-suspenders, `cacheClear()` is already exported "for logout / session reset" — ensure the sign-out path and any org-switch path call it. (It is the correct invalidation hook should an org switch ever happen in-tab.)

### (b) `src/lib/staffCache.ts` — **client-side singleton; global-safe but harden on logout**
Module-level `_data`/`_promise` fetched from `/api/staff` (which is itself org-scoped server-side). Same per-tab reasoning as cache.ts → global-safe. The risk is **org switch without page reload** leaving stale staff. Fix: ensure `invalidateStaffCache()` (already exported) is wired into the sign-out / org-switch flow. No key change needed. Add note:

```ts
// SAFETY: per-browser-tab singleton; the /api/staff endpoint is org-scoped
// server-side, so these arrays are already this-org-only. Call
// invalidateStaffCache() on sign-out / org-switch to drop stale state.
let _promise: Promise<StaffMember[]> | null = null;
```

### (c) `src/lib/receivingCache.ts` — **client-side in-flight dedup; global-safe**
Single `_promise` that is *nulled on resolution* — it only dedups concurrent fetches of `/api/receiving-logs` (org-scoped server-side) within one tab, within one event-loop turn. It holds no cross-request data. **Verdict: global-safe.** Note it:

```ts
// SAFETY: client-only in-flight deduplicator, cleared on resolve. Holds no
// persisted data and is per-tab; the endpoint is org-scoped server-side.
let _promise: Promise<ReceivingLogsResult> | null = null;
```

### (d) `src/lib/auth/role-store.ts` — **SERVER-side, process-wide; NOT global-safe — MUST be org-keyed**
This is the dangerous one. The header comment is explicit: *"this module is imported by Node-only route handlers... we want process-wide."* Both `rolesCache` (a single `RolesSnapshot`) and `staffRolesCache` (`Map<number, …>` keyed by `staffId`) are shared across **all tenants on the same Lambda instance.**

- `rolesCache`: `fetchRoles()` does `SELECT ... FROM roles` with **no org filter**. The `roles` table is org-scoped (it's in the 93 org tables). So org #2's request, hitting a warm Lambda, gets **USAV's roles back** — a privilege/permission cross-tenant leak. This is a real RBAC vulnerability under multi-tenant.
- `staffRolesCache`: keyed by `staffId` only. `staff.id` is globally unique (serial PK), so the key won't collide *today*, but the query `SELECT sr.role_id FROM staff_roles sr JOIN roles r` returns role rows from the global roles table — same leak surface, and the key carries no org so it's brittle.

**Fix: make both caches org-aware.** Key `rolesCache` per org, and include `orgId` in the `staffRolesCache` key. The cleanest path that matches the rest of the codebase is to thread `orgId` (from `ctx.organizationId`) into the loaders.

Snapshot store → per-org map:

```ts
// was: let rolesCache: RolesSnapshot | null = null;
//      let inflightRoles: Promise<RolesSnapshot> | null = null;
const rolesCacheByOrg = new Map<string, RolesSnapshot>();
const inflightRolesByOrg = new Map<string, Promise<RolesSnapshot>>();
```

`fetchRoles` gains an org filter:

```ts
async function fetchRoles(orgId: string): Promise<RolesSnapshot> {
  const r = await pool.query(
    `SELECT id, key, label, color, position, permissions, is_system, mobile_defaults
       FROM roles
      WHERE organization_id = $1
      ORDER BY position ASC, id ASC`,
    [orgId],
  );
  // ... unchanged mapping ...
}
```

`getRolesSnapshot` keyed by org:

```ts
async function getRolesSnapshot(orgId: string): Promise<RolesSnapshot> {
  const now = Date.now();
  const cached = rolesCacheByOrg.get(orgId);
  if (cached && cached.expiresAt > now) return cached;
  const inflight = inflightRolesByOrg.get(orgId);
  if (inflight) return inflight;
  const p = fetchRoles(orgId).then((snap) => {
    rolesCacheByOrg.set(orgId, snap);
    inflightRolesByOrg.delete(orgId);
    return snap;
  }).catch((err) => {
    inflightRolesByOrg.delete(orgId);
    throw err;
  });
  inflightRolesByOrg.set(orgId, p);
  return p;
}
```

Public loaders take `orgId`; `invalidateRoleCache` becomes per-org:

```ts
export async function loadAllRoles(orgId: string): Promise<ReadonlyArray<RoleRow>> {
  return (await getRolesSnapshot(orgId)).orderedByPosition;
}
export async function loadRoleById(orgId: string, id: number): Promise<RoleRow | null> {
  return (await getRolesSnapshot(orgId)).byId.get(id) ?? null;
}
export async function loadRoleByKey(orgId: string, key: string): Promise<RoleRow | null> {
  return (await getRolesSnapshot(orgId)).byKey.get(key) ?? null;
}
export function invalidateRoleCache(orgId?: string): void {
  if (orgId) { rolesCacheByOrg.delete(orgId); } else { rolesCacheByOrg.clear(); }
}
```

Staff-roles key composite `${orgId}:${staffId}`:

```ts
const staffRolesCache = new Map<string, StaffAssignmentSnapshot>(); // key: `${orgId}:${staffId}`

export async function loadStaffRoleIds(orgId: string, staffId: number): Promise<number[]> {
  const key = `${orgId}:${staffId}`;
  const cached = staffRolesCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.roleIds;
  const r = await pool.query(
    `SELECT sr.role_id
       FROM staff_roles sr JOIN roles r ON r.id = sr.role_id
      WHERE sr.staff_id = $1 AND r.organization_id = $2
      ORDER BY r.position ASC, r.id ASC`,
    [staffId, orgId],
  );
  const roleIds = (r.rows as Array<{ role_id: number }>).map((row) => row.role_id);
  staffRolesCache.set(key, { roleIds, expiresAt: Date.now() + STAFF_ROLES_TTL_MS });
  return roleIds;
}

export async function loadRolesForStaff(orgId: string, staffId: number): Promise<RoleRow[]> {
  const [ids, snap] = await Promise.all([
    loadStaffRoleIds(orgId, staffId), getRolesSnapshot(orgId),
  ]);
  const out: RoleRow[] = [];
  for (const id of ids) { const r = snap.byId.get(id); if (r) out.push(r); }
  return out;
}

export function invalidateStaffRolesCache(orgId?: string, staffId?: number): void {
  if (orgId == null) { staffRolesCache.clear(); return; }
  if (staffId == null) {
    const p = `${orgId}:`;
    for (const k of staffRolesCache.keys()) if (k.startsWith(p)) staffRolesCache.delete(k);
  } else {
    staffRolesCache.delete(`${orgId}:${staffId}`);
  }
}
```

`effectivePermissionsForStaff` / `primaryRoleForStaff` add `orgId` as the first param and forward it.

**Caller fan-out:** `getCurrentUser()` and `withAuth` are the hot readers cited in the header comment — they already know `organizationId` (it's on `CurrentUser`/`AuthContext`). Thread it in. The admin role/assignment mutation endpoints that call `invalidateRoleCache()` / `invalidateStaffRolesCache(id)` must pass `ctx.organizationId`. This is the single highest-priority fix of the five — it is an active RBAC cross-tenant leak under warm Lambdas, not just a hygiene issue.

---

## D5 — `src/lib/api-guard.ts` rate limiting → default scope to `ctx.organizationId`

### Finding
`buildKey` composes `${routeKey}${scope}:${ip}`. `scope` is optional and almost never passed (only `src/app/api/log-error/route.ts` passes `scope: ctx.staffId`). So today the limiter is keyed by route+IP only. Two problems for multi-tenant:
1. **Shared NAT / office IP**: all of one tenant's staff behind one office IP share a single bucket → noisy-neighbor self-DoS. Worse, two tenants behind the same upstream proxy (Vercel edge sometimes collapses) could share a bucket.
2. The limiter cannot distinguish tenants, so per-tenant abuse can't be isolated.

The library already accepts `scope`. The fix is to **always pass `ctx.organizationId` as scope on authed routes** so each tenant gets its own bucket, with IP retained as the within-tenant dimension. Do this at the `withAuth` layer so every authed route inherits it instead of touching 12 call sites.

### Recommended: centralize in `withAuth`
If `withAuth` runs the limiter, default `scope` to `ctx.organizationId`. If it doesn't, add a thin authed wrapper. The minimal library-side change makes the intent explicit and gives a helper:

```ts
// src/lib/api-guard.ts
export interface RateLimitOptions {
  headers: Headers;
  routeKey: string;
  limit: number;
  windowMs: number;
  /** Tenant/identity scope. For authed routes pass ctx.organizationId so each
   *  tenant gets an isolated bucket and one tenant can't exhaust another's. */
  scope?: string | number | null;
}
```

`buildKey` already incorporates scope — no change needed there. The behavioral change is at the call sites / wrapper. Add a convenience overload that bakes in org scoping:

```ts
/** Authed rate-limit: keys per (route, org, ip). Prefer this in withAuth-wrapped
 *  routes so a tenant's traffic can't be starved by another tenant's. */
export function checkRateLimitForOrg(
  opts: Omit<RateLimitOptions, 'scope'> & { organizationId: string | null },
): Promise<RateLimitResult> {
  return checkRateLimitAsync({ ...opts, scope: opts.organizationId ?? 'anon' });
}
```

Then in each authed route currently calling `checkRateLimitAsync({ headers, routeKey, limit, windowMs })`, change to `checkRateLimitForOrg({ headers, routeKey, limit, windowMs, organizationId: ctx.organizationId })`. The 12 callers (`scan-tracking`, `tech/scan`, `ai/chat`, `ai/search`, `shipping/track/*`, `receiving-lines/incoming/refresh*`, etc.) all run under `withAuth` and have `ctx`. `auth/signup` is pre-auth (no org yet) → keep IP-only there (don't pass org).

### Upstash Redis prod config — **finding: NOT confirmed; flag it**
`checkRateLimitAsync` reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` at module load. If both are unset it silently falls back to the in-memory `Map`, which the file's own header calls *"NOT fine for production multi-instance"* — under Vercel autoscaling the effective limit becomes `limit × instances`, i.e. **rate limiting is effectively off in prod.** I checked `.env`, `.env.local`, and `vercel.json`: **neither `UPSTASH_REDIS_*` var is present locally**, so it is either set only in the Vercel dashboard or not at all. Action item:
- Run `vercel env ls production | grep UPSTASH` (project isn't fully linked in this sandbox) to confirm both vars exist in the Production environment.
- If absent, the limiter is inert in prod — provision an Upstash Redis (Vercel Marketplace) and set both REST vars, then redeploy (env changes need a redeploy, per the CRON_SECRET memory note about Vercel env propagation).
- Note: the catch/`!res.ok` paths fail **open** (`return checkRateLimit(opts)`), which is the right call for a rate limiter but means a misconfigured Redis degrades silently — add a one-time boot warning:

```ts
if (!isRedisConfigured()) {
  console.warn('[api-guard] UPSTASH_REDIS not configured — rate limiting is per-instance only (NOT safe in prod multi-instance).');
}
```

---

## D4/D5 cross-cut — `src/lib/audit-logs.ts`: thread `organization_id`

### Finding
`audit_logs` **already has** a nullable `organization_id uuid` column + `idx_audit_logs_organization` index (added in `src/lib/migrations/2026-05-23_org_id_on_business_tables.sql` lines 159–178; backfilled from `staff.organization_id`; left nullable because system events have no actor; **no FK, no RLS** — classification `usav-fallback` in coverage). But `createAuditLog`'s INSERT **omits the column entirely**, so every new row writes `NULL`. `recordAudit` already receives `ctx` (which carries `organizationId`) — it just isn't being forwarded.

### Code — add `organizationId` to `CreateAuditLogParams` + INSERT

```ts
export interface CreateAuditLogParams {
  organizationId?: string | null;   // ← add
  actorStaffId?: number | null;
  actorRole?: string | null;
  source: string;
  // ... rest unchanged ...
}

export async function createAuditLog(
  db: Queryable,
  params: CreateAuditLogParams,
): Promise<number | null> {
  const result = await db.query(
    `INSERT INTO audit_logs (
      organization_id,
      actor_staff_id,
      actor_role,
      source,
      action,
      entity_type,
      entity_id,
      station_activity_log_id,
      request_id,
      ip_address,
      user_agent,
      before_data,
      after_data,
      metadata
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb
    )
    RETURNING id`,
    [
      params.organizationId ?? null,
      params.actorStaffId ?? null,
      params.actorRole ?? null,
      params.source,
      params.action,
      params.entityType,
      String(params.entityId),
      params.stationActivityLogId ?? null,
      params.requestId ?? null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
      params.beforeData ? JSON.stringify(params.beforeData) : null,
      params.afterData ? JSON.stringify(params.afterData) : null,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}
```
(Note the placeholder renumbering: org is `$1`, everything shifts by one, and the two jsonb casts move to `$12/$13/$14`.)

### Code — pull `organizationId` from `ctx` in `recordAudit`
`ctx` is `AuthContext | AnonymousAuthContext | null`; both have `organizationId` (`string` / `string | null`). Forward it:

```ts
export async function recordAudit(
  db: Queryable,
  ctx: AuthContext | AnonymousAuthContext | null,
  req: Pick<NextRequest, 'headers'> | null,
  args: RecordAuditArgs,
): Promise<number | null> {
  const actorStaffId = ctx?.staffId ?? args.actorStaffIdOverride ?? null;
  const actorRole = ctx?.role ?? null;
  const organizationId = ctx?.organizationId ?? null;   // ← add
  // ... unchanged header/ip/metadata logic ...

  try {
    return await createAuditLog(db, {
      organizationId,                                    // ← pass through
      actorStaffId,
      actorRole,
      source: args.source,
      // ... rest unchanged ...
    });
  } catch (err) {
    console.warn('[audit_logs] write failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

### Optional hardening for `RecordAuditArgs`
A few system callers (cron, pipeline) pass `ctx = null` (they use `actorStaffIdOverride`). For those, `organizationId` will be NULL — same as today's backfill leaves system rows NULL, which is acceptable per the migration's stated design. If you want those stamped too, add `organizationIdOverride?: string | null` to `RecordAuditArgs` and use `ctx?.organizationId ?? args.organizationIdOverride ?? null`. The transitionalUsavOrgId callers (orders-ingest-drain, orchestrator, collect, fulfillment-sync) should pass that override with their resolved org.

### `auth_audit` — note (no fix this phase)
`auth_audit` has **no `organization_id` column** (confirmed: coverage classifies it `child-scoped(staff)`, `has_org: false`, FK to `staff` only). It's reachable from `staff.organization_id` via JOIN, so tenant-scoped reads are possible but not indexable. This module (`audit-logs.ts`) does **not** write `auth_audit` — sign-in/PIN events do, elsewhere. **Recommendation:** leave `auth_audit` as child-scoped (the staff FK is the tenant anchor) OR, if you want it directly filterable, add an `organization_id` column in a later migration mirroring the audit_logs block (backfill from staff, nullable, indexed). Flag it as known debt; do not block D4 on it.

---

## B4 — Burn down `USAV_ORG_ID` env-fallback debt

Three importers, two different fallback shapes. `constants.ts` is explicit: *"New code MUST NOT import USAV_ORG_ID... migration debt that needs to be paid down before the second customer onboards."*

### (a) `src/lib/integrations/credentials.ts` — env fallback gated on `orgId === USAV_ORG_ID`
This one is **architecturally correct and intentionally transitional** (lines 85–88: *"Any new code MUST NOT add to this"*). The env fallback only fires when `orgId === USAV_ORG_ID` and only after the DB lookup misses, so it cannot leak across tenants. **Do not delete it now** — it's the bridge that lets USAV run on env vars while org #2 runs on `organization_integrations` rows.

**Burn-down plan (sequenced):**
1. For each provider in `envFallback`, write USAV's current env values into `organization_integrations` via `upsertIntegrationCredentials({ orgId: USAV_ORG_ID, provider, payload })` — a one-shot migration script. The encryption path (`encryptIntegrationPayload`) already exists.
2. Once a provider's row exists for USAV, the DB branch returns first and the env branch is dead for that provider — verify per provider, then **delete that `case` from `envFallback`**.
3. When `envFallback` is empty, delete the function, the `import { USAV_ORG_ID }`, and the `if (orgId === USAV_ORG_ID)` block (lines 218–225). `getIntegrationCredentials` then returns `null` for any unconfigured org — the correct multi-tenant default.

Add a tracking guard so no new provider silently leans on env:

```ts
// envFallback is FROZEN. Do not add cases. Each existing case is deleted as its
// USAV organization_integrations row is provisioned (see B4 burn-down). Goal: empty fn.
```

### (b) `src/lib/ebay/browse-client.ts` — `params.orgId ?? USAV_ORG_ID` default (line 108)
This silently defaults any caller that forgets `orgId` to USAV's eBay creds. The real fix is to **make `orgId` required** and remove the `USAV_ORG_ID` import:

```ts
export interface BrowseSearchParams {
  q: string;
  conditions?: BrowseCondition[];
  maxPriceCents?: number | null;
  categoryIds?: string | null;
  limit?: number;
  orgId: OrgId;            // ← required, was `orgId?: OrgId`
}

export async function browseSearch(params: BrowseSearchParams): Promise<BrowseSearchResult> {
  const orgId = params.orgId;     // ← no `?? USAV_ORG_ID`
  const creds = await getIntegrationCredentials<EbayCredentials>(orgId, 'ebay');
  if (!creds) throw new Error('eBay credentials are not configured for this organization');
  // ... unchanged ...
}
```
Delete `import { USAV_ORG_ID, type OrgId }` → `import { type OrgId }`.

**Caller fix:** `src/lib/sourcing/search.ts` passes `orgId: params.orgId` (its own field is `orgId?: OrgId`, line 32). Make `search.ts`'s param required too and chase it up to its route handler, which has `ctx.organizationId`. This converts a silent-USAV-default into a compile error anywhere org isn't threaded — exactly what you want for burn-down. Net: one import removed, the default eliminated, type system enforces org propagation.

### (c) `src/app/api/auth/staff-picker/route.ts` — apex-host → USAV fallback (line 43)
`resolveOrgId` returns `USAV_ORG_ID` when there's no `x-tenant-slug` header (apex host). This is **deliberate and documented** (the JSDoc: *"On the apex/no-subdomain host the USAV tenant is returned for backwards compatibility"*). It is a **public, read-only** endpoint exposing only `id/name/role/color_hex/has_pin` — and it is correctly scoped (`WHERE organization_id = $1`) and already returns the zero-UUID empty set for unknown slugs. So it does not leak across tenants; it just hard-wires "apex == USAV."

**Burn-down:** this is the *last* USAV fallback to remove, because it's load-bearing for USAV's current root-domain sign-in UX. Plan:
1. Make a config-driven default tenant instead of a hard-coded constant. Add an env var `DEFAULT_TENANT_SLUG` (or an `organizations.is_apex_default` flag) and resolve:
   ```ts
   async function resolveOrgId(req: NextRequest): Promise<string> {
     const slug = req.headers.get('x-tenant-slug') ?? process.env.DEFAULT_TENANT_SLUG ?? null;
     if (!slug) return '00000000-0000-0000-0000-000000000000'; // no default → empty, not USAV
     const org = await getOrganizationBySlug(slug);
     return org?.id ?? '00000000-0000-0000-0000-000000000000';
   }
   ```
   Set `DEFAULT_TENANT_SLUG=usav` in Vercel so behavior is unchanged today, but the USAV identity moves out of code into config. Delete the `import { USAV_ORG_ID }`.
2. Once USAV is reachable at `usav.app.<domain>` (subdomain routing live), drop `DEFAULT_TENANT_SLUG` entirely and the apex host returns the empty set — matching the JSDoc's stated end-state ("the root host will return USAV-only" → eventually nothing).

### B4 summary table

| File | USAV_ORG_ID use | Leak risk today | Action this phase | End state |
|---|---|---|---|---|
| `integrations/credentials.ts` | env fallback, gated on `orgId===USAV` | None (gated + DB-first) | Freeze fn; provision USAV `organization_integrations` rows | Delete `envFallback` + import |
| `ebay/browse-client.ts` | `params.orgId ?? USAV_ORG_ID` default | Silent USAV default if caller omits org | Make `orgId` required; delete import; fix `sourcing/search.ts` caller | No fallback; type-enforced org |
| `auth/staff-picker/route.ts` | apex-host default | None (public, read-only, org-scoped) | Move to `DEFAULT_TENANT_SLUG` env; delete import | Drop env when subdomain routing ships |

---

## Priority ranking (do these in order)
1. **`role-store.ts` (D4d)** — active RBAC cross-tenant leak under warm Lambdas; the `roles` SELECT has no org filter and the snapshot is process-wide. Highest severity.
2. **`audit-logs.ts` (D4 cross-cut)** — column already exists + ctx already in hand; trivial, makes every audit row tenant-attributable. Do alongside #1.
3. **`api-guard.ts` (D5)** — default scope to `ctx.organizationId` **and** confirm `UPSTASH_REDIS_*` is actually set in Vercel Production (currently unverifiable from the repo — likely a real gap).
4. **`po-gmail/client.ts` (D3)** — add the `assertUsavMailbox` guard; cheap, prevents a future cross-tenant mailbox read.
5. **B4 burn-down** — `browse-client.ts` required-`orgId` is a quick, safe win; `credentials.ts` and `staff-picker` are sequenced/config-driven and should be last.

### Files referenced (all absolute)
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/po-gmail/client.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/po-gmail/messages.ts` (also calls `poGmailFetch`)
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/cache.ts`, `staffCache.ts`, `receivingCache.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/auth/role-store.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/api-guard.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/audit-logs.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/migrations/2026-05-23_org_id_on_business_tables.sql` (lines 159–178 — audit_logs org column already exists)
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/integrations/credentials.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/ebay/browse-client.ts` + `/Users/icecube/repos/USAV-Orders-Backend/src/lib/sourcing/search.ts` (caller)
- `/Users/icecube/repos/USAV-Orders-Backend/src/app/api/auth/staff-picker/route.ts`
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/tenancy/constants.ts` (`USAV_ORG_ID`, `OrgId`)
- `/Users/icecube/repos/USAV-Orders-Backend/src/lib/auth/withAuth.ts` (`AuthContext.organizationId` at line 42; anonymous at line 58)