import { NextRequest, NextResponse } from 'next/server';

export function requireInternalToken(req: NextRequest): NextResponse | null {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) return null;

  const rawAuth = req.headers.get('authorization') || '';
  const bearer = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : '';
  const headerToken = req.headers.get('x-internal-token') || '';

  if (bearer === expected || headerToken === expected) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
