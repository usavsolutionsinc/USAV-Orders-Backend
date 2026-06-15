import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

/**
 * Row shape mirrors Drizzle's `aiChatMessages.$inferSelect` so the JSON
 * response keys are unchanged after moving off the ORM onto the GUC-wrapped
 * tenant pool. Columns are aliased to camelCase to preserve the exact shape.
 */
interface ChatMessageRow {
  organizationId: string;
  id: number;
  sessionId: string;
  role: string;
  content: string;
  mode: string | null;
  analysis: unknown;
  error: boolean | null;
  createdAt: Date;
}

/**
 * GET /api/ai/chat-sessions/[sessionId]/messages — load all messages for a session
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const gate = await requireRoutePerm(req, 'dashboard.view');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  try {
    const { sessionId } = await params;
    // Tenant-scoped read: run through the GUC-wrapped tenant pool AND filter
    // explicitly on organization_id so a cross-tenant sessionId can never
    // surface another org's messages.
    const result = await tenantQuery<ChatMessageRow>(
      orgId,
      `SELECT organization_id AS "organizationId",
              id,
              session_id      AS "sessionId",
              role,
              content,
              mode,
              analysis,
              error,
              created_at      AS "createdAt"
         FROM ai_chat_messages
        WHERE session_id = $1
          AND organization_id = $2
        ORDER BY created_at ASC`,
      [sessionId, orgId],
    );
    const messages = result.rows;

    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error('[chat-messages] load error:', err?.message);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
