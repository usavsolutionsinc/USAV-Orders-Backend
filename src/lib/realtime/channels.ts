/**
 * Ably channel names — ORG-NAMESPACED.
 *
 * Every channel is `org:{orgId}:{suffix}`. The org boundary is enforced two ways:
 *   1. The token endpoint (src/app/api/realtime/token/route.ts) grants a client
 *      capability ONLY for its own `org:{ctx.organizationId}:*` — so even if a
 *      client builds another org's channel name, Ably denies the subscribe.
 *   2. `orgChannelPrefix()` THROWS on a missing/malformed org id, so a publisher
 *      can never accidentally build an un-namespaced (cross-tenant) channel.
 *
 * Server publishers pass `ctx.organizationId` (or `transitionalUsavOrgId()` for
 * the transitional jobs). Client subscribers pass `user.organizationId` from the
 * auth context and must wrap construction in `safeChannelName()` (which returns
 * '' instead of throwing) so a not-yet-hydrated user gates `enabled=false`
 * rather than crashing the render.
 */

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
  // Strip control chars defensively; Ably rejects names with embedded newlines.
  const sanitized = raw.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return sanitized || fallback;
}

/**
 * Org channel prefix. THROWS on a missing/malformed org id — a realtime channel
 * must never be built without a tenant, or two tenants would share it. Callers
 * are server-side publishers (orgId from ctx.organizationId) and the token
 * endpoint. Client code that may not have a hydrated org yet must use
 * `safeChannelName()` to gate on a valid name instead of catching this throw.
 */
export function orgChannelPrefix(orgId: string): string {
  const id = String(orgId || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new Error(`[realtime] refusing to build channel for non-uuid org id: ${JSON.stringify(orgId)}`);
  }
  return `org:${id}`;
}

/**
 * Client-safe wrapper: returns the built name, or '' if the org id is missing /
 * malformed (so the caller can pass `enabled = !!name` to useAblyChannel rather
 * than crash). Example:
 *   const ch = safeChannelName(() => getOrdersChannelName(orgId));
 *   useAblyChannel(ch, 'order.changed', handler, !!ch && enabled);
 */
export function safeChannelName(build: () => string): string {
  try {
    return build();
  } catch {
    return '';
  }
}

// ─── Shared (per-org broadcast) channels ──────────────────────────────────
// Channel suffixes are fixed in-code — the DEFAULT_* constants above are the
// single source of truth. Tenant isolation is the `org:{orgId}` prefix
// (enforced by the token endpoint + orgChannelPrefix()); there is no
// per-deployment env override of channel names.

export const getOrdersChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_ORDERS_CHANNEL}`;

export const getRepairsChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_REPAIRS_CHANNEL}`;

export const getAiAssistChannelName = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_AI_ASSIST_CHANNEL}`;

export const getAiAssistSessionChannelName = (orgId: string, sessionId: string) =>
  `${getAiAssistChannelName(orgId)}:${normalizeChannelName(sessionId, 'session')}`;

/** Single channel for all station-level row changes (tech logs, packer logs, receiving). */
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

// ─── DB-row change channels ────────────────────────────────────────────────

export const getDbChannelPrefix = (orgId: string) =>
  `${orgChannelPrefix(orgId)}:${DEFAULT_DB_CHANNEL_PREFIX}`;

export const getDbTableChannelName = (orgId: string, schema: string, table: string) =>
  `${getDbChannelPrefix(orgId)}:${schema}:${table}`;

export const getDbRowChannelName = (orgId: string, schema: string, table: string, rowId: string | number) =>
  `${getDbTableChannelName(orgId, schema, table)}:${rowId}`;

// ─── Per-staff channels ─────────────────────────────────────────────────────
//
// Each is locked to a single staffId AND namespaced by org. The token endpoint
// grants only the caller's own staffId channels (no cross-staff wildcard), so a
// staffer can neither read nor forge another staffer's inbox/bridge events.

/** Per-staff inbox: priority alerts, staff messages, warranty/tech nudges. */
export const getInboxChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:inbox:${normalizeChannelName(String(staffId), 'none')}`;

/** Phone→desktop receiving-station photo bridge (phone publishes scans). */
export const getPhoneBridgeChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:phone:${normalizeChannelName(String(staffId), 'none')}`;

/** Desktop→phone packer wizard hand-off (desktop publishes scan_ready). */
export const getPackerBridgeChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:packer:${normalizeChannelName(String(staffId), 'none')}`;

/**
 * Per-staff desktop↔phone lookup echo bridge. Was the raw `station:{staffId}`,
 * renamed to `staffstation:` so the org's `:station:*` broadcast grant can never
 * widen to this per-staff bridge.
 */
export const getStaffStationBridgeChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:staffstation:${normalizeChannelName(String(staffId), 'none')}`;

/** Phone→desktop scan-history feed (read-only; never writes receiving_*). */
export const getScanLogChannelName = (orgId: string, staffId: number | string) =>
  `${orgChannelPrefix(orgId)}:scanlog:${normalizeChannelName(String(staffId), 'none')}`;
