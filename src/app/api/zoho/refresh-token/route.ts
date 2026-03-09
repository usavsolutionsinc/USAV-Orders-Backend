import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const token = await getAccessToken();
    return NextResponse.json({
      success: true,
      message: 'Zoho access token refreshed successfully.',
      access_token_preview: token ? `${token.slice(0, 6)}...` : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to refresh Zoho token';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
