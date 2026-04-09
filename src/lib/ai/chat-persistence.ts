import { db } from '@/lib/drizzle/db';
import { aiChatSessions, aiChatMessages } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Ensure a session row exists, then insert one message.
 * Runs fire-and-forget from the chat route — errors are logged, never thrown.
 */
export async function persistChatMessage(opts: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: string | null;
  analysis?: unknown;
  error?: boolean;
}): Promise<void> {
  try {
    // Upsert session (create if first message, update timestamp otherwise)
    const existing = await db
      .select({ id: aiChatSessions.id })
      .from(aiChatSessions)
      .where(eq(aiChatSessions.id, opts.sessionId))
      .limit(1);

    if (existing.length === 0) {
      // Generate title from first user message (first 80 chars)
      const title =
        opts.role === 'user'
          ? opts.content.slice(0, 80) + (opts.content.length > 80 ? '...' : '')
          : 'New Chat';

      await db.insert(aiChatSessions).values({
        id: opts.sessionId,
        title,
      });
    } else {
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(aiChatSessions.id, opts.sessionId));
    }

    // Insert message
    await db.insert(aiChatMessages).values({
      sessionId: opts.sessionId,
      role: opts.role,
      content: opts.content,
      mode: opts.mode ?? null,
      analysis: opts.analysis ?? null,
      error: opts.error ?? false,
    });
  } catch (err: any) {
    console.error('[chat-persistence] error:', err?.message);
  }
}
