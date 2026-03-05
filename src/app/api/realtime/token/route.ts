import { NextRequest, NextResponse } from 'next/server';
import Ably from 'ably';
import { getOrdersChannelName, getRepairsChannelName } from '@/lib/realtime/channels';

export const runtime = 'nodejs';

let ablyRestClient: Ably.Rest | null = null;

function getAblyRestClient() {
  const key = process.env.ABLY_API_KEY;
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

  const capability = JSON.stringify({
    [getOrdersChannelName()]: ['subscribe'],
    [getRepairsChannelName()]: ['subscribe'],
  });

  const tokenRequest = await client.auth.createTokenRequest({
    clientId,
    capability,
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
