import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { aiChatMessages, aiChatSessions } from '@/lib/drizzle/schema';
import { eq, asc } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * GET /api/ai/chat-sessions/[sessionId]/messages — load all messages for a session
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const messages = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, sessionId))
      .orderBy(asc(aiChatMessages.createdAt));

    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error('[chat-messages] load error:', err?.message);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
