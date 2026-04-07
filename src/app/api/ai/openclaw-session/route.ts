import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/**
 * Generates a new chat session ID server-side.
 * The ID is a standard UUID — the OpenClaw backend stores messages keyed by
 * whatever session_id the client sends, so any unique string works.
 */
export async function POST() {
  return NextResponse.json({ session_id: randomUUID() });
}
