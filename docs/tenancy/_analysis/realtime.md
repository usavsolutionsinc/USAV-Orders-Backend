I now have a complete picture. Producing the spec.

---

# Phase D1 — Ably Realtime Org-Isolation Remediation Spec

## 0. Threat model (why this is the worst gap)

Three independent flaws compound into a full cross-tenant live data leak. None requires DB RLS to be bypassed — Ably is a separate plane entirely:

1. **All channel names are global.** `getOrdersChannelName()` returns the literal `orders:changes` for everyone (`src/lib/realtime/channels.ts:16-21`). Tenant B's order mutations are published to the same `orders:changes` channel Tenant A's browser is subscribed to. Same for `station:changes`, `staff:changes`, `repair:changes`, `fba:changes`, `dashboard:operations`, `walkin:changes`, and every `db:public:<table>` channel.

2. **The token endpoint grants every authenticated user wildcard capabilities** (`src/app/api/realtime/token/route.ts:50-69`): `db:*`, `phone:*`, `station:*`, `packer:*`, `inbox:*` all with `subscribe` (and `publish` on the last four). Any signed-in user of any tenant can `subscribe` to `inbox:<anyStaffId>`, `phone:<anyStaffId>`, `station:<anyStaffId>`, `db:public:<anyTable>`, and can **publish forged events** onto another staffer's `inbox`/`station`/`packer` channels.

3. **`clientId` is derived from a client-supplied header, not the session.** `const userHint = req.headers.get('x-user-id') || 'dashboard-user'` (`token/route.ts:45`). Confirmed via grep: **nothing in the codebase ever sets `x-user-id`** — the Ably client connects via bare `authUrl` (`src/contexts/AblyContext.tsx:40-46`) with no `authHeaders`/`authCallback`, so today `clientId` is always `dashboard-user-<random>`. The intended per-staff identity is not enforced at all, and if a caller *did* set the header it would be trusted blindly.

The fix has three coordinated parts: (1) make every channel name carry the org uuid; (2) rewrite the token endpoint to derive org from `ctx.organizationId` and `clientId` from `ctx.staffId`, granting capabilities only to `org:{orgId}:*`; (3) thread `orgId` through every publish call site and every client subscriber.

**Architectural constraint discovered:** the client (`AuthSessionUser` in `src/contexts/AuthContext.tsx:45-57`) does **not** know its `organizationId` — it only has `staffId`. The browser therefore **cannot and must not** build org-namespaced channel names itself. The org boundary is enforced server-side in the token endpoint via the granted capability set; the client subscribes to a name returned/known to it. This forces a specific design (see §4): the client builds channel names from an org token it receives from the token endpoint, OR the builders run server-side only. The chosen approach below: **the token endpoint returns the org-prefix to the client, and `AuthSessionUser` is extended with `organizationId`** so client builders can compose names — but security never depends on the client using the right name; it depends on the capability grant.

---

## 1. New channel scheme + rewritten `src/lib/realtime/channels.ts`

### Naming convention

Every channel becomes `org:{orgId}:{...existing-suffix}`. The orgId is the tenant uuid (e.g. `00000000-0000-0000-0000-000000000001`). Examples:

| Old (global) | New (org-namespaced) |
|---|---|
| `orders:changes` | `org:{orgId}:orders:changes` |
| `repair:changes` | `org:{orgId}:repair:changes` |
| `station:changes` | `org:{orgId}:station:changes` |
| `staff:changes` | `org:{orgId}:staff:changes` |
| `fba:changes` | `org:{orgId}:fba:changes` |
| `dashboard:operations` | `org:{orgId}:dashboard:operations` |
| `walkin:changes` | `org:{orgId}:walkin:changes` |
| `ai:assist` / `ai:assist:{sid}` | `org:{orgId}:ai:assist` / `org:{orgId}:ai:assist:{sid}` |
| `db:public:<table>` | `org:{orgId}:db:public:<table>` |
| `db:public:<table>:<row>` | `org:{orgId}:db:public:<table>:<row>` |
| `inbox:{staffId}` | `org:{orgId}:inbox:{staffId}` |
| `phone:{staffId}` | `org:{orgId}:phone:{staffId}` |
| `packer:{staffId}` | `org:{orgId}:packer:{staffId}` |
| `station:{staffId}` (per-staff bridge) | `org:{orgId}:staffstation:{staffId}` |
| `scanlog:{staffId}` | `org:{orgId}:scanlog:{staffId}` |

**Note on the per-staff `station:{staffId}` bridge** (`useReceivingLineCore.ts:332`, `usePhoneScanBridge.ts:60`): it currently collides namespace-wise with the global `station:changes` only because the capability wildcard `station:*` covers both. After namespacing, keep them distinct by renaming the per-staff bridge to `staffstation:` so the `org:{orgId}:station:*` grant doesn't accidentally widen to the global station feed. This is a behavioral rename — both publisher and subscriber must change together (see §3 checklist items for `publishEvent('station:...')`-style raw strings).

### Builder signatures — every builder takes `orgId` as its first arg

A single helper builds the prefix; `normalizeOrgId` rejects anything that isn't a uuid so a malformed/empty org can never collapse two tenants onto one channel.

```ts
// src/lib/realtime/channels.ts

export const DEFAULT_ORDERS_CHANNEL = 'orders:changes';
export const DEFAULT_REPAIRS_CHANNEL = 'repair:changes';
export const DEFAULT_AI_ASSIST_CHANNEL = 'ai:assist';
export const DEFAULT_STATION_CHANNEL = 'station:changes';
export const DEFAULT_STAFF_CHANNEL = 'staff:changes';
export const DEFAULT_DB_CHANNEL_PREFIX = 'db';
export const DEFAULT_FBA_CHANNEL = 'fba:changes';
export const DEFAULT_DASHBOARD_CHANNEL = 'dashboard:operations';
export const DEFAULT_WALKIN_CHANNEL = 'walkin:changes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeChannelName(value: string | undefined | null, fallback: string): string {
  const raw = String(value || '');
  const sanitized = raw.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return sanitized || fallback;
}

/**
 * Org channel prefix. THROWS on a missing/malformed org id — a realtime
 * channel must never be built without a tenant, or two tenants would share it.
 * Callers are server-side publishers (orgId from ctx.organizationId) and the
 * token endpoint (orgId from ctx.organizationId). The browser composes names
 * from the org id it receives in its session (AuthSessionUser.organizationId).
 */
export function orgChannelPrefix(orgId: string): string {
  const id = String(orgId || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new Error(`[realtime] refusing to build channel for non-uuid org id: ${JSON.stringify(orgId)}`);
  }
  return `org:${id}`;
}

// Channel suffixes are fixed in-code (DEFAULT_* constants). No env override —
// tenant isolation is the org:{orgId} prefix only.

// ─── Shared (per-org broadcast) channels ──────────────────────────────────

export const getOrdersChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_ORDERS_CHANNEL}`;

export const getRepairsChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_REPAIRS_CHANNEL}`;

export const getAiAssistChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_AI_ASSIST_CHANNEL}`;

export const getAiAssistSessionChannelName = (orgId: string, sessionId: string) =>
  `${getAiAssistChannelName(orgId)}:${normalizeChannelName(sessionId, 'session')}`;

export const getStationChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_STATION_CHANNEL}`;

export const getStaffChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_STAFF_CHANNEL}`;

export const getFbaChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_FBA_CHANNEL}`;

export const getDashboardChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_DASHBOARD_CHANNEL}`;

export const getWalkInChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_WALKIN_CHANNEL}`;

// ─── DB-row channels ──────────────────────────────────────────────────────

export const getDbChannelPrefix = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_DB_CHANNEL_PREFIX}`;

export const getDbTableChannelName = (orgId: string, schema: string, table: string) =>
  `${getDbChannelPrefix(orgId)}:${schema}:${table}`;

export const getDbRowChannelName = (orgId: string, schema: string, table: string, rowId: string | number) =>
  `${getDbTableChannelName(orgId, schema, table)}:${rowId}`;

// ─── Per-staff channels ───────────────────────────────────────────────────

export const getInboxChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:inbox:${normalizeChannelName(String(staffId), 'none')}`;

export const getPhoneBridgeChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:phone:${normalizeChannelName(String(staffId), 'none')}`;

export const getPackerBridgeChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:packer:${normalizeChannelName(String(staffId), 'none')}`;

/** Per-staff desktop↔phone lookup echo bridge (was the colliding `station:{staffId}`). */
export const getStaffStationBridgeChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:staffstation:${normalizeChannelName(String(staffId), 'none')}`;

export const getScanLogChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:scanlog:${normalizeChannelName(String(staffId), 'none')}`;
```

New exported builders (`getPhoneBridgeChannelName`, `getPackerBridgeChannelName`, `getStaffStationBridgeChannelName`, `getScanLogChannelName`) replace the raw template literals `phone:${...}`, `packer:${...}`, `station:${...}`, `scanlog:${...}` scattered across the codebase. **No raw channel string literals may survive** — see §3 checklist.

---

## 2. Rewritten `src/app/api/realtime/token/route.ts`

The org comes from `ctx.organizationId` (session-derived, never the request). `clientId` is the session `staffId`. Capabilities are scoped to `org:{orgId}:*` with the per-staff resources locked to the *caller's own* staffId (no wildcard `inbox:*`). The wildcard cross-staff publish is removed; a staffer can only publish to their own bridge channels.

```ts
import { NextRequest, NextResponse } from 'next/server';
import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import {
  orgChannelPrefix,
  getOrdersChannelName,
  getRepairsChannelName,
  getAiAssistChannelName,
  getStationChannelName,
  getStaffChannelName,
  getFbaChannelName,
  getDashboardChannelName,
  getWalkInChannelName,
  getInboxChannelName,
  getPhoneBridgeChannelName,
  getPackerBridgeChannelName,
  getStaffStationBridgeChannelName,
  getScanLogChannelName,
  getDbChannelPrefix,
} from '@/lib/realtime/channels';
import { withAuth, type AuthContext } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

let ablyRestClient: Ably.Rest | null = null;

function sanitizeSessionId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().slice(0, 120);
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function getAblyRestClient() {
  const key = getValidatedAblyApiKey();
  if (!key) return null;
  if (!ablyRestClient) ablyRestClient = new Ably.Rest({ key });
  return ablyRestClient;
}

async function createTokenRequest(req: NextRequest, ctx: AuthContext) {
  const client = getAblyRestClient();
  if (!client) {
    return NextResponse.json({ error: 'ABLY_API_KEY is not configured' }, { status: 500 });
  }

  const orgId = ctx.organizationId;       // session-derived tenant — NOT from the request
  const staffId = ctx.staffId;            // session-derived identity — NOT from x-user-id
  const prefix = orgChannelPrefix(orgId); // throws on a non-uuid org → 500 (fail closed)

  // clientId is the authoritative, session-bound identity. Ably stamps every
  // message this connection publishes with it, so a client can no longer forge
  // another staffer's identity by setting a header.
  const clientId = `org:${orgId}:staff:${staffId}`;

  const sessionId = sanitizeSessionId(req.headers.get('x-ai-session'));
  const aiSessionChannel = sessionId ? `${getAiAssistChannelName(orgId)}:${sessionId}` : null;

  // Own per-staff channels (subscribe + publish only for THIS staffId).
  const inboxOwn       = getInboxChannelName(orgId, staffId);
  const phoneOwn       = getPhoneBridgeChannelName(orgId, staffId);
  const packerOwn      = getPackerBridgeChannelName(orgId, staffId);
  const staffStationOwn = getStaffStationBridgeChannelName(orgId, staffId);
  const scanLogOwn     = getScanLogChannelName(orgId, staffId);

  const capability: Record<string, string[]> = {
    // Org-wide broadcast feeds — read-only for clients (servers publish via REST key).
    [getOrdersChannelName(orgId)]: ['subscribe'],
    [getRepairsChannelName(orgId)]: ['subscribe'],
    [getAiAssistChannelName(orgId)]: ['subscribe'],
    [getStationChannelName(orgId)]: ['subscribe'],
    [getStaffChannelName(orgId)]: ['subscribe'],
    [getFbaChannelName(orgId)]: ['subscribe'],
    [getDashboardChannelName(orgId)]: ['subscribe'],
    [getWalkInChannelName(orgId)]: ['subscribe'],

    // Per-org DB-row feed — wildcard is now SCOPED to this org's prefix only.
    [`${getDbChannelPrefix(orgId)}:*`]: ['subscribe'],

    // Per-staff bridges — the wildcard is gone. Only THIS staffId's channels,
    // and each device side may both publish and subscribe to its own pair.
    [inboxOwn]: ['subscribe', 'publish'],
    [phoneOwn]: ['subscribe', 'publish'],
    [packerOwn]: ['subscribe', 'publish'],
    [staffStationOwn]: ['subscribe', 'publish'],
    [scanLogOwn]: ['subscribe', 'publish'],
  };

  if (aiSessionChannel) {
    capability[aiSessionChannel] = ['subscribe', 'publish'];
  }

  // Defense in depth: assert every granted resource is inside this org prefix.
  for (const resource of Object.keys(capability)) {
    if (!resource.startsWith(`${prefix}:`)) {
      return NextResponse.json(
        { error: 'Internal: capability leaked outside org prefix', resource },
        { status: 500 },
      );
    }
  }

  const tokenRequest = await client.auth.createTokenRequest({
    clientId,
    capability: JSON.stringify(capability),
    ttl: 60 * 60 * 1000,
  });

  return NextResponse.json(tokenRequest);
}

export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    return await createTokenRequest(req, ctx);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create realtime token', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'dashboard.view' });

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    return await createTokenRequest(req, ctx);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create realtime token', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'dashboard.view' });
```

**What changed and why each matters:**
- `x-user-id` header read is **deleted**. `clientId` is now `org:{orgId}:staff:{staffId}` from the verified session (`ctx.staffId` is non-null on the authenticated `AuthContext`, per `withAuth.ts:40`).
- Every capability key is an org-prefixed concrete name. The only remaining wildcard is `org:{orgId}:db:*`, which can never reach another tenant.
- `inbox:*`, `phone:*`, `station:*`, `packer:*` cross-staff wildcards are **removed**. A client gets capability only for its own `staffId`'s bridge channels. (See §6 for the one consequence this has on publishers that target *other* staffers — those run on the server REST key, which is unaffected, so this is purely a tightening with no functional regression.)
- The capability-prefix assertion loop is a fail-closed guard against a future builder regression.

---

## 3. Exhaustive publish-call-site checklist

All server-side publishers must obtain `orgId` and pass it to the builder. The canonical source is `ctx.organizationId` in route handlers; for jobs/services that currently use `transitionalUsavOrgId()`, pass that same value through (it's already imported in `publish.ts:16`). **Plumbing decision:** add an `orgId: string` field to every `publish*` payload type so the call site supplies it explicitly. This is the cleanest thread-through and makes the org visible at each of the ~80 call sites.

### 3a. `src/lib/realtime/publish.ts` — rewrite every publisher to take `orgId`

Each exported `publish*` function gains `orgId` (either as a new payload field or a leading param) and passes it to the builder. Specific edits:

| Function | Line | Builder call to change |
|---|---|---|
| `publishDashboardUpdate` | 111 | `getDashboardChannelName(payload.orgId)` |
| `publishOrderChanged` | 255 | `getOrdersChannelName(payload.orgId)` |
| `publishOrderAssignmentsUpdated` | 284 | `getOrdersChannelName(payload.orgId)` |
| `publishQueueAssignmentsUpdated` | 302 | `getOrdersChannelName(payload.orgId)` |
| `publishOrderTested` | 317 | `getOrdersChannelName(payload.orgId)` |
| `publishRepairChanged` | 330 | `getRepairsChannelName(payload.orgId)` |
| `publishPriorityUnbox` | 357 | `getInboxChannelName(payload.orgId, staffId)` |
| `publishStaffMessage` | 388 | `getInboxChannelName(payload.orgId, recipientId)` |
| `publishWarrantyClaimNotification` | 441 | `getInboxChannelName(payload.orgId, staffId)` |
| `publishTechInbox` (`publishReturnPendingTest`/`publishOrderReadyShip`) | 470 | `getInboxChannelName(payload.orgId, staffId)` — also pass orgId to `getPrimaryTechStaffIds()` so only this org's techs are nudged |
| `publishAiAssistantMessage` | 486 | `getAiAssistSessionChannelName(payload.orgId, payload.sessionId)` |
| `publishStaffScheduleChanged` | 498 | `getStaffChannelName(payload.orgId)` |
| `publishTechLogChanged` | 508 | `getStationChannelName(payload.orgId)` |
| `publishPackerLogChanged` | 520 | `getStationChannelName(payload.orgId)` |
| `publishPackerScanReady` | 564 | replace raw `` `packer:${payload.staffId}` `` → `getPackerBridgeChannelName(payload.orgId, payload.staffId)` |
| `publishScanLog` | 597 | replace raw `` `scanlog:${staffId}` `` → `getScanLogChannelName(payload.orgId, staffId)` |
| `publishReceivingLogChanged` | 608 | `getStationChannelName(payload.orgId)` |
| `publishShipmentChanged` | 631 | `getStationChannelName(payload.orgId)` |
| `publishFbaItemChanged` | 664 | `getFbaChannelName(payload.orgId)` |
| `publishFbaShipmentChanged` | 676 | `getFbaChannelName(payload.orgId)` |
| `publishFbaCatalogChanged` | 686 | `getFbaChannelName(payload.orgId)` |
| `publishActivityLogged` | 715 | `getStationChannelName(payload.orgId)` + forward `orgId` into the `publishDashboardUpdate({ orgId, ... })` call at 732 |
| `publishStockLedgerEvent` | 776 | forward `orgId` into `publishActivityLogged({ orgId, ... })` |

Also fix the internal `logRealtimeEventToStationActivity` → `publishActivityLogged` calls (lines 161, 187, 210, 237): they currently use `transitionalUsavOrgId()` for the `organizationId` of the station-activity row but call `publishActivityLogged` without an org. Pass `transitionalUsavOrgId()` as the orgId there too (this path is the self-derived activity feed and is single-tenant today; keep it consistent).

### 3b. `src/lib/realtime/db-events.ts` — `publishDbEvent`

`RealtimeDbEvent` (line 5) gains a required `orgId: string`. Update lines 54 & 57:
```ts
await client.channels.get(getDbTableChannelName(event.orgId, event.schema, event.table)).publish('db.row.changed', basePayload);
if (rowId != null) {
  await client.channels.get(getDbRowChannelName(event.orgId, event.schema, event.table, rowId)).publish('db.row.changed', basePayload);
}
```
Callers:
- `src/app/api/webhooks/realtime-db/route.ts:32` — the webhook body must now carry `orgId`; add it to the required-fields check at line 28 (`!body?.orgId`) and validate it's a uuid. The external publisher (DB trigger / sidecar) must include `orgId`.
- `src/lib/workflow/events.ts:16` — `emitWorkflowEvent` must take `orgId` and pass `orgId` into the `publishDbEvent({ orgId, ... })` call. Its caller (the workflow engine) must thread the org from the workflow definition's `organization_id`.

### 3c. `src/lib/realtime/walkin-events.ts` — `publishSaleCompleted`

Add `orgId` to the payload (line 16) and `getWalkInChannelName(orgId)` (line 23). Caller `src/app/api/webhooks/square/route.ts:110` — Square webhook is org-ambiguous; resolve the org from the matched walk-in sale / Square account mapping before publishing. **This is a real gap to resolve, not a mechanical rename** — flag it.

### 3d. Route/job/lib publish call sites — pass `ctx.organizationId` (or `transitionalUsavOrgId()`)

Every file from the publisher grep must supply `orgId` to its `publish*` call. Routes use `ctx.organizationId`; the 7 transitional callers use `transitionalUsavOrgId()`. Full list (file → which publishers it calls; confirmed via the grep):

**Orders / assignments / tested:**
- `src/app/api/orders/[id]/route.ts`, `orders/[id]/tracking/route.ts`, `orders/add/route.ts`, `orders/assign/route.ts`, `orders/check-shipped/route.ts`, `orders/delete/route.ts`, `orders/missing-parts/route.ts`, `orders/set-item-number/route.ts`
- `src/lib/orders/invalidation.ts` (shared helper — give it an `orgId` param; every caller already has `ctx`)
- `src/lib/shipping/publish-on-status-change.ts` (shared — same: add `orgId` param)
- `src/app/api/tracking-exceptions/[id]/refresh/route.ts`, `ecwid/sync-exception-tracking/route.ts`
- `src/lib/jobs/google-sheets-transfer-orders.ts` (transitional → `transitionalUsavOrgId()`)

**Repairs:**
- `src/app/api/repair-service/[id]/route.ts`, `repair-service/pickup/route.ts`, `repair-service/repaired/route.ts`, `repair-service/route.ts`, `repair/actions/[id]/route.ts`, `repair/actions/route.ts`, `repair/submit/route.ts`, `work-orders/route.ts`

**Tech / station / activity:**
- `src/app/api/tech/delete/route.ts`, `tech/scan-repair-station/route.ts`, `tech/scan-sku/route.ts`, `tech/scan/route.ts`, `tech/serial/route.ts`, `scan/resolve/route.ts`
- `src/lib/tech/insertTechSerialForTracking.ts` (shared — add `orgId` param)
- `src/lib/neon/stock-ledger-helpers.ts` (calls `publishStockLedgerEvent` — add `orgId` param; callers have ctx)
- `src/components/sku/LocationDetailView.tsx` — **note this is a client component** that imports `getStationChannelName`; see §4 (it must use the org-aware client builder, not call a server publisher).

**Receiving:**
- `src/app/api/receiving-entry/route.ts`, `receiving-lines/route.ts`, `receiving-logs/route.ts`, `receiving-tasks/route.ts`, `receiving/[id]/attach-box/route.ts`, `receiving/[id]/route.ts`, `receiving/add-unmatched-line/route.ts`, `receiving/lines/[id]/condition/route.ts`, `receiving/lines/[id]/putaway/route.ts`, `receiving/lines/[id]/status/route.ts`, `receiving/lookup-po/route.ts`, `receiving/mark-received-po/route.ts`, `receiving/mark-received/route.ts`, `receiving/match/route.ts`, `receiving/po/[poId]/attach-box/route.ts`, `receiving/scan-serial/route.ts`, `receiving/serials/route.ts`, `zoho/purchase-orders/receive/route.ts`
- `src/lib/receiving/receive-line.ts` (shared — add `orgId` param)

**Packing:**
- `src/app/api/packing-logs/route.ts`, `packing-logs/update/route.ts`

**FBA:** all 21 `src/app/api/fba/**` route files from the grep call `publishFba*` — each passes `ctx.organizationId`.

**Staff schedule / messages:**
- `src/app/api/staff-messages/route.ts`, `staff/schedule/bulk/route.ts`, `staff/schedule/route.ts`, `staff/schedule/week/copy/route.ts`, `staff/schedule/week/route.ts`

**Warranty:**
- `src/lib/warranty/notify.ts` (calls `publishWarrantyClaimNotification` — add `orgId` param; the warranty claim row already has `organization_id`).

**Transitional/service callers** (use `transitionalUsavOrgId()`): `src/services/OrderSyncService.ts`, `src/lib/zoho/fulfillment-sync.ts`, `src/lib/pipeline/orchestrator.ts`, `src/lib/pipeline/collect.ts`, `src/app/api/cron/zoho/orders-ingest-drain/route.ts` (these are in the established transitional set; route their org through the same helper).

---

## 4. Exhaustive client-subscriber checklist

**Prerequisite for all client work:** extend `AuthSessionUser` (`src/contexts/AuthContext.tsx:45`) with `organizationId: string`, and populate it from `/api/auth/me` (the endpoint already has the session org). Expose it via the auth context. Client builders then read `user.organizationId`. **Security does not depend on this value** — even if a client lied about its org, the Ably token it holds only grants `org:{itsRealOrg}:*`, so subscribing to another org's channel name fails with a capability error. The org id on the client is for *constructing the right name to subscribe to*, not for authorization.

Because builders now require `orgId`, every module that currently computes channel names at **module top-level** (a `const X = getOrdersChannelName()` at import time, before any user exists) must move that computation **inside the component/hook body** where `user.organizationId` is available. This is a structural change in several files.

| File | Current usage | Required change |
|---|---|---|
| `src/hooks/useRealtimeInvalidation.ts:15-18` | module-level consts `ORDERS_CHANNEL`/`REPAIRS_CHANNEL`/`STATION_CHANNEL`/`WALKIN_CHANNEL` | Move inside `useRealtimeInvalidation`; read `const { user } = useAuth(); const orgId = user?.organizationId`; build names there; gate `useAblyChannel(..., enabled && !!orgId)`. |
| `src/hooks/useUpNextData.ts:193-196` | builds orders/repairs/station/fba names inside hook (already body-level) | Pass `orgId` to each builder; guard on `orgId`. |
| `src/hooks/useRepairs.ts:10-11` | module-level `REPAIRS_CHANNEL` + `REPAIR_DB_CHANNEL` (`getDbTableChannelName('public','repair_service')`) | Move inside `useRepairsTable`; `getRepairsChannelName(orgId)`, `getDbTableChannelName(orgId,'public','repair_service')`. |
| `src/hooks/usePackerLogs.ts:83` | module-level `STATION_CHANNEL` | Move inside hook; `getStationChannelName(orgId)`. |
| `src/hooks/useTechLogs.ts:96` | module-level `STATION_CHANNEL` | Move inside hook; `getStationChannelName(orgId)`. |
| `src/hooks/useFbaRealtimeInvalidation.ts:8` | module-level `FBA_CHANNEL` | Move inside hook; `getFbaChannelName(orgId)`. |
| `src/hooks/useWalkInSales.ts:10` | module-level `WALKIN_CHANNEL` | Move inside hook; `getWalkInChannelName(orgId)`. |
| `src/hooks/useTodayStaffAvailability.ts:74` | `getStaffChannelName()` inside hook | Pass `orgId`. |
| `src/hooks/usePhoneScanBridge.ts:32,60` | raw `` `phone:${staffId}` `` + `client.channels.get(stationChannelName)` where `stationChannelName` is the per-staff `station:${staffId}` bridge | Use `getPhoneBridgeChannelName(orgId, staffId)` and `getStaffStationBridgeChannelName(orgId, staffId)` (the renamed bridge). |
| `src/components/PendingOrdersTable.tsx:73` | `getOrdersChannelName()` inside component | Pass `orgId`. |
| `src/components/unshipped/UnshippedTable.tsx:72` | `getOrdersChannelName()` | Pass `orgId`. |
| `src/components/admin/StaffManagementTab.tsx:45` | `getStaffChannelName()` | Pass `orgId`. |
| `src/components/fba/sidebar/FbaSidebar.tsx:50-52` | module-level 3× `getDbTableChannelName('public', ...)` | Move inside component; pass `orgId` to each (`fba_shipments`, `fba_shipment_items`, `fba_shipment_tracking`). |
| `src/components/sidebar/receiving/IncomingDetailsPanel.tsx:25` | module-level `STATION_CHANNEL = getStationChannelName()` | Move inside component; `getStationChannelName(orgId)`. |
| `src/components/sku/LocationDetailView.tsx:170` | `getStationChannelName()` (client component) | Pass `orgId` from auth context. |
| `src/components/sidebar/ReceivingSidebarPanel.tsx:179,193,967` | raw `` `phone:${staffIdNum}` `` (`phoneChannelName`) + `client.channels.get(stationChannelName)` | `getPhoneBridgeChannelName(orgId, staffIdNum)`; `stationChannelName` → `getStationChannelName(orgId)`. |
| `src/components/receiving/workspace/line-edit/hooks/useReceivingLineCore.ts:332` | raw `` `station:${staffIdNum}` `` (per-staff bridge) | `getStaffStationBridgeChannelName(orgId, staffIdNum)`. |
| `src/contexts/ActivityInboxContext.tsx:318` | `getInboxChannelName(user?.staffId ?? 'none')` | `getInboxChannelName(orgId, user?.staffId ?? 'none')` — `user.organizationId` is available here. |
| `src/components/quick-access/PhoneHistoryPopover.tsx:104` | raw `` `scanlog:${staffId}` `` / `'scanlog:__idle__'` | `getScanLogChannelName(orgId, staffId)`; idle fallback when no org/staff → `enabled=false`. |
| `src/components/mobile/receiving/MobileReceivingList.tsx:73` | raw `` `phone:${staffId}` `` / `'phone:__idle__'` | `getPhoneBridgeChannelName(orgId, staffId)`; gate enabled on org+staff. |
| `src/components/mobile/receiving/PhotoCaptureSurface.tsx:87` | `client.channels.get(`phone:${notifyStaffId}`)` (publish) | `getPhoneBridgeChannelName(orgId, notifyStaffId)`. |
| `src/app/m/r/[id]/photos/page.tsx:119` | `client.channels.get(`phone:${staffId}`)` (publish) | `getPhoneBridgeChannelName(orgId, staffId)`. |
| `src/components/receiving/workspace/line-edit/ReceivingPhotoButton.tsx:70` | raw `` `phone:${staffId}` `` / idle | `getPhoneBridgeChannelName(orgId, staffId)`. |
| `src/components/receiving/workspace/PhotosCard.tsx:58` | raw `` `phone:${staffId}` `` / idle | `getPhoneBridgeChannelName(orgId, staffId)`. |
| `src/components/sidebar/ReceivingPhotoStrip.tsx:68` | raw `` `phone:${staffId}` `` / idle | `getPhoneBridgeChannelName(orgId, staffId)`. |
| `src/components/layout/ResponsiveLayout.tsx:292` (comment-only ref; verify actual subscribe nearby) | subscribes to `phone:{staffId}` | confirm + use `getPhoneBridgeChannelName(orgId, staffId)`. |

**Packer wizard (mobile) `packer:{staffId}`:** the desktop publisher is `publishPackerScanReady` (server, §3a). The mobile subscriber side — search confirms `packer:` is referenced in the wizard; locate the actual `client.channels.get(`packer:${staffId}`)` subscription (it pairs with `publishPackerScanReady`) and switch to `getPackerBridgeChannelName(orgId, staffId)`. (The grep surfaced `packer:` mostly as role strings; the live subscription is in the mobile pack flow — verify `src/app/m/pack` / packer wizard component during implementation.)

**`useAblyChannel` itself** (`src/hooks/useAblyChannel.ts`) needs no change — it's name-agnostic — but every caller must pass `enabled = false` until `orgId` is known, to avoid building a name from `undefined` (the builder would throw). The `'use client'` builders should treat a missing org as `enabled=false`, not as a thrown error: wrap client-side name construction so a missing org yields a sentinel that is never subscribed (`enabled` gate), since `orgChannelPrefix` throws. Recommended: a thin client helper `safeChannel(fn)` that returns `null` instead of throwing, paired with `enabled = !!name`.

---

## 5. Migration / rollout sequencing (no flag-day breakage)

Publishers and subscribers must flip together per channel family, or live updates silently stop. Two safe options:

- **Dual-publish window (recommended):** temporarily have `publishEvent` publish to *both* the old global name and the new `org:{orgId}:` name for one deploy; flip subscribers; then remove the global publish and tighten the token. This keeps the dashboard live throughout. The token endpoint must, during the window, grant *both* the global names (subscribe-only) and the org names — then drop the global grants in the final tighten step.
- **Single coordinated deploy:** acceptable only because today the system is effectively single-tenant (USAV is the only real org); a brief realtime gap on deploy is tolerable. If you take this path, ship publishers + token + subscribers in one PR.

Order within the coordinated deploy: (1) `channels.ts` builders, (2) `token/route.ts`, (3) `AuthSessionUser.organizationId` + `/api/auth/me`, (4) all publishers (`publish.ts`, `db-events.ts`, `walkin-events.ts`, `workflow/events.ts` + every call site), (5) all subscribers. Build-gate with `tsc` — the new required `orgId` params will surface every un-migrated call site as a type error, which is the enforcement mechanism (don't make `orgId` optional).

---

## 6. Open items requiring a decision (call out before coding)

1. **Square webhook org resolution** (`webhooks/square/route.ts:110` → `publishSaleCompleted`): the webhook has no session/org. Resolve org from the Square account→org mapping or the matched sale row. Until resolved, this publisher cannot be namespaced correctly — it's the one genuine design gap, not a rename.
2. **`realtime-db` webhook** (`webhooks/realtime-db/route.ts`): the external trigger/sidecar must now include `orgId` in the body. The DB row's `organization_id` is the natural source; the trigger must emit it. Coordinate with whatever populates this webhook.
3. **`getPrimaryTechStaffIds()`** (`publish.ts:459`, used by `publishTechInbox`): must be filtered by `orgId` or it will nudge techs across all orgs. Add an `orgId` param to the query in `src/lib/neon/staff-stations-queries.ts`.
4. **Capability size:** moving from 4 wildcards to ~13 concrete keys + 1 scoped wildcard is well within Ably's capability limits; no concern.
5. **Removed cross-staff publish wildcards:** confirmed safe — every cross-staff publish in `publish.ts` (`publishStaffMessage`, `publishWarrantyClaimNotification`, `publishPriorityUnbox`, `publishTechInbox`) runs on the **server REST key** (`getAblyRestClient()` in `publish.ts:86-94`), which is unrestricted by token capabilities. Only the *browser* loses cross-staff publish, which it never legitimately used. No functional regression.

---

## Files to change (summary)

Core: `src/lib/realtime/channels.ts`, `src/app/api/realtime/token/route.ts`, `src/lib/realtime/publish.ts`, `src/lib/realtime/db-events.ts`, `src/lib/realtime/walkin-events.ts`, `src/lib/workflow/events.ts`, `src/contexts/AuthContext.tsx` (add `organizationId`), `src/app/api/auth/me` route (emit org).

Server publisher call sites: ~70 files listed in §3d (all `src/app/api/**` order/repair/tech/receiving/packing/fba/staff routes) plus shared helpers `src/lib/orders/invalidation.ts`, `src/lib/shipping/publish-on-status-change.ts`, `src/lib/tech/insertTechSerialForTracking.ts`, `src/lib/neon/stock-ledger-helpers.ts`, `src/lib/receiving/receive-line.ts`, `src/lib/warranty/notify.ts`, and transitional `src/services/OrderSyncService.ts`, `src/lib/zoho/fulfillment-sync.ts`, `src/lib/pipeline/orchestrator.ts`, `src/lib/pipeline/collect.ts`, `src/lib/jobs/google-sheets-transfer-orders.ts`, `src/app/api/cron/zoho/orders-ingest-drain/route.ts`.

Client subscribers: the 24 files in §4 (hooks `useRealtimeInvalidation`, `useUpNextData`, `useRepairs`, `usePackerLogs`, `useTechLogs`, `useFbaRealtimeInvalidation`, `useWalkInSales`, `useTodayStaffAvailability`, `usePhoneScanBridge`; components `PendingOrdersTable`, `UnshippedTable`, `StaffManagementTab`, `FbaSidebar`, `IncomingDetailsPanel`, `LocationDetailView`, `ReceivingSidebarPanel`, `useReceivingLineCore`, `ActivityInboxContext`, `PhoneHistoryPopover`, `MobileReceivingList`, `PhotoCaptureSurface`, `m/r/[id]/photos/page`, `ReceivingPhotoButton`, `PhotosCard`, `ReceivingPhotoStrip`, `ResponsiveLayout`, + the mobile packer-wizard `packer:` subscriber).

Webhooks needing org resolution: `src/app/api/webhooks/square/route.ts`, `src/app/api/webhooks/realtime-db/route.ts`.