import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// This scheduled job has been removed to prevent exceeding the Zoho API 5,000-call rate limit.
// Zoho API calls are restricted to tracking-number matching fetches only.
export async function POST() {
  return NextResponse.json({ error: 'This job has been disabled' }, { status: 410 });
}

export async function GET() {
  return NextResponse.json({ ok: false, disabled: true, reason: 'zoho-items-sync job removed — rate limit' });
}
