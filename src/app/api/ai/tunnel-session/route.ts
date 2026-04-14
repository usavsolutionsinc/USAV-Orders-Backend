import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/**
 * Generates a new chat session ID server-side.
 * The ID is a standard UUID. /api/ai/openclaw-chat forwards it to the local
 * Hermes gateway as `X-Hermes-Session-Id` so Hermes can persist the
 * conversation in ~/.hermes-usav/state.db for follow-up turn memory.
 */
export async function POST() {
  return NextResponse.json({ session_id: randomUUID() });
}
