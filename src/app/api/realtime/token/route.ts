import { NextRequest, NextResponse } from 'next/server';
import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import {
  getAiAssistChannelName,
  getDbChannelPrefix,
  getFbaChannelName,
  getOrdersChannelName,
  getRepairsChannelName,
  getStaffChannelName,
  getStationChannelName,
} from '@/lib/realtime/channels';

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

async function createTokenRequest(req: NextRequest) {
  const client = getAblyRestClient();
  if (!client) {
    return NextResponse.json(
      { error: 'ABLY_API_KEY is not configured' },
      { status: 500 }
    );
  }

  const userHint = req.headers.get('x-user-id') || 'dashboard-user';
  const clientId = `${userHint}-${Math.random().toString(36).slice(2, 10)}`;
  const sessionId = sanitizeSessionId(req.headers.get('x-ai-session'));
  const aiSessionChannel = sessionId ? `${getAiAssistChannelName()}:${sessionId}` : null;

  const capability: Record<string, string[]> = {
    [getOrdersChannelName()]: ['subscribe'],
    [getRepairsChannelName()]: ['subscribe'],
    [getAiAssistChannelName()]: ['subscribe'],
    [getStationChannelName()]: ['subscribe'],
    [getStaffChannelName()]: ['subscribe'],
    [getFbaChannelName()]: ['subscribe'],
    [`${getDbChannelPrefix()}:*`]: ['subscribe'],
    // Desktop listens for phone-originated scans on its own per-staff channel.
    'phone:*': ['subscribe'],
    // Desktop echoes scan results back to paired phones on per-staff station channel.
    'station:*': ['subscribe', 'publish'],
    // Desktop subscribes to pair:{code} while the pairing modal is open to
    // learn the moment a phone redeems the code (server publishes on claim).
    'pair:*': ['subscribe'],
  };

  if (aiSessionChannel) {
    capability[aiSessionChannel] = ['subscribe', 'publish'];
  }

  const tokenRequest = await client.auth.createTokenRequest({
    clientId,
    capability: JSON.stringify(capability),
    ttl: 60 * 60 * 1000,
  });

  return NextResponse.json(tokenRequest);
}

export async function GET(req: NextRequest) {
  try {
    return await createTokenRequest(req);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create realtime token', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    return await createTokenRequest(req);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create realtime token', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
