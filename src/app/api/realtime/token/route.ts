import { NextRequest, NextResponse } from 'next/server';
import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import {
  orgChannelPrefix,
  getOrdersChannelName,
  getRepairsChannelName,
  getAiAssistChannelName,
  getAiAssistSessionChannelName,
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
  if (!ablyRestClient) {
    ablyRestClient = new Ably.Rest({ key });
  }
  return ablyRestClient;
}

async function createTokenRequest(req: NextRequest, ctx: AuthContext) {
  const client = getAblyRestClient();
  if (!client) {
    return NextResponse.json(
      { error: 'ABLY_API_KEY is not configured' },
      { status: 500 }
    );
  }

  // Org + identity come from the verified SESSION, never the request. This is
  // the entire security boundary: Ably enforces these capabilities server-side,
  // so a client can only ever subscribe/publish within its own org, and only to
  // its own per-staff channels.
  const orgId = ctx.organizationId;
  const staffId = ctx.staffId;
  const prefix = orgChannelPrefix(orgId); // throws on a non-uuid org → 500 (fail closed)

  // clientId stamps every message this connection publishes — a client can no
  // longer forge another staffer's identity via a header (the old x-user-id).
  const clientId = `org:${orgId}:staff:${staffId}`;

  const sessionId = sanitizeSessionId(req.headers.get('x-ai-session'));
  const aiSessionChannel = sessionId ? getAiAssistSessionChannelName(orgId, sessionId) : null;

  // Own per-staff channels — subscribe + publish for THIS staffId only.
  const inboxOwn = getInboxChannelName(orgId, staffId);
  const phoneOwn = getPhoneBridgeChannelName(orgId, staffId);
  const packerOwn = getPackerBridgeChannelName(orgId, staffId);
  const staffStationOwn = getStaffStationBridgeChannelName(orgId, staffId);
  const scanLogOwn = getScanLogChannelName(orgId, staffId);

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

    // Per-org DB-row feed — the wildcard is SCOPED to this org's prefix only,
    // so it can never reach another tenant's `org:{other}:db:*`.
    [`${getDbChannelPrefix(orgId)}:*`]: ['subscribe'],

    // Per-staff bridges — NO cross-staff wildcard. Only THIS staffId's channels,
    // each device side may both publish and subscribe to its own pair.
    [inboxOwn]: ['subscribe', 'publish'],
    [phoneOwn]: ['subscribe', 'publish'],
    [packerOwn]: ['subscribe', 'publish'],
    [staffStationOwn]: ['subscribe', 'publish'],
    [scanLogOwn]: ['subscribe', 'publish'],
  };

  if (aiSessionChannel) {
    capability[aiSessionChannel] = ['subscribe', 'publish'];
  }

  // Defense in depth: assert every granted resource is inside this org's prefix.
  // A future builder regression that leaked a bare/global name fails closed here.
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
      { status: 500 }
    );
  }
}, { permission: 'dashboard.view' });

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    return await createTokenRequest(req, ctx);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create realtime token', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}, { permission: 'dashboard.view' });
