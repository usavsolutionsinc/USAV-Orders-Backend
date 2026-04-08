import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// This scheduled job has been removed to prevent flooding the eBay API with calls.
export async function POST() {
  return NextResponse.json({ error: 'This job has been disabled' }, { status: 410 });
}

export async function GET() {
  return NextResponse.json({ ok: false, disabled: true, reason: 'ebay-sync job removed — API flood' });
}
