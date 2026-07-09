import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { listCallEvents, type CallDirectionFilter } from '@/lib/voice/call-queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/call-events?direction=inbound|outbound|missed&q=  → { items: CallEventDTO[] }
 * The Calls Monitor stream (org-scoped, newest-first).
 */

function parseDirection(raw: string | null): CallDirectionFilter {
  return raw === 'inbound' || raw === 'outbound' || raw === 'missed' ? raw : 'all';
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const items = await listCallEvents(ctx.organizationId, {
        direction: parseDirection(sp.get('direction')),
        query: sp.get('q'),
      });
      return NextResponse.json({ items });
    } catch (err) {
      return errorResponse(err, 'GET /api/call-events');
    }
  },
  { permission: 'integrations.zendesk' },
);
