import { NextRequest, NextResponse } from 'next/server';
import Ably from 'ably';
import pool from '@/lib/db';
import { claimPairCode } from '@/lib/phone-pair';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';

export const runtime = 'nodejs';

async function fetchStaffName(staffId: number): Promise<string | null> {
  try {
    const r = await pool.query<{ name: string | null }>(
      'SELECT name FROM staff WHERE id = $1 LIMIT 1',
      [staffId],
    );
    const name = (r.rows[0]?.name || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

let ablyRest: Ably.Rest | null = null;

function getAblyRest(): Ably.Rest | null {
  const key = getValidatedAblyApiKey();
  if (!key) return null;
  if (!ablyRest) ablyRest = new Ably.Rest({ key });
  return ablyRest;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || '').trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ success: false, error: 'code is required' }, { status: 400 });
    }

    const claim = await claimPairCode(code);
    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'Pairing code invalid or expired' },
        { status: 404 },
      );
    }

    const rest = getAblyRest();
    if (!rest) {
      return NextResponse.json(
        { success: false, error: 'Realtime not configured' },
        { status: 500 },
      );
    }

    // Phone may only publish on its own phone channel, and only subscribe to
    // its own station channel — absolute minimum capability for the scan flow.
    const phoneChannel = `phone:${claim.staffId}`;
    const stationChannel = `station:${claim.staffId}`;

    const clientId = `phone-${claim.staffId}-${Math.random().toString(36).slice(2, 10)}`;
    const capability: Record<string, string[]> = {
      [phoneChannel]: ['publish'],
      [stationChannel]: ['subscribe'],
    };

    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      capability: JSON.stringify(capability),
      ttl: 4 * 60 * 60 * 1000, // 4 hours: phone stays bonded for a shift
    });

    const staffName = await fetchStaffName(claim.staffId);

    // Notify the desktop that issued the code. Best-effort; failure here
    // must not block the phone's pairing — the modal has a manual close too.
    try {
      const pairChannel = rest.channels.get(`pair:${code}`);
      await pairChannel.publish('paired', {
        staff_id: claim.staffId,
        staff_name: staffName,
        phone_channel: phoneChannel,
        station_channel: stationChannel,
      });
    } catch (err) {
      console.warn('pair/claim: failed to publish paired event', err);
    }

    return NextResponse.json({
      success: true,
      staff_id: claim.staffId,
      staff_name: staffName,
      phone_channel: phoneChannel,
      station_channel: stationChannel,
      token_request: tokenRequest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to claim pair code';
    console.error('pair/claim POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
