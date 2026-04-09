import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { aiChatSessions, aiChatMessages } from '@/lib/drizzle/schema';
import { desc, eq, sql, count } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * GET /api/ai/chat-sessions — list recent sessions (sidebar)
 * Returns the 30 most recent sessions with message count and preview.
 */
export async function GET() {
  try {
    const sessions = await db
      .select({
        id: aiChatSessions.id,
        title: aiChatSessions.title,
        createdAt: aiChatSessions.createdAt,
        updatedAt: aiChatSessions.updatedAt,
        messageCount: count(aiChatMessages.id),
      })
      .from(aiChatSessions)
      .leftJoin(aiChatMessages, eq(aiChatSessions.id, aiChatMessages.sessionId))
      .groupBy(aiChatSessions.id)
      .orderBy(desc(aiChatSessions.updatedAt))
      .limit(30);

    return NextResponse.json({ sessions });
  } catch (err: any) {
    console.error('[chat-sessions] list error:', err?.message);
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 });
  }
}

/**
 * DELETE /api/ai/chat-sessions?id=<sessionId> — delete a session
 */
export async function DELETE(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('id');
    if (!sessionId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    await db.delete(aiChatSessions).where(eq(aiChatSessions.id, sessionId));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[chat-sessions] delete error:', err?.message);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
