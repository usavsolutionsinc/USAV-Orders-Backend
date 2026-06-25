import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getUsers,
  isZendeskConfigured,
  ZendeskApiError,
  ZendeskNotConfiguredError,
} from '@/lib/zendesk';

export const dynamic = 'force-dynamic';

/**
 * Zendesk users batch lookup.
 *
 *   GET /api/zendesk/users?ids=1,2,3  → { success, users: [{id,name,email,...}] }
 *
 * Resolves comment authors (the requester / end users that aren't agents) to a
 * real name + email so the chat thread never shows a bare "User #<id>".
 * Gated by integrations.zendesk like the rest of the Zendesk surface.
 */

function notConfigured(context: string): NextResponse {
  return errorResponse(
    new ApiError(503, 'Zendesk is not configured', 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN.'),
    context,
  );
}

function mapZendeskError(err: unknown, context: string): NextResponse {
  if (err instanceof ZendeskNotConfiguredError) return notConfigured(context);
  if (err instanceof ZendeskApiError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return errorResponse(new ApiError(status, 'Zendesk API error', err.message), context);
  }
  return errorResponse(err, context);
}

export const GET = withAuth(
  async (req: NextRequest) => {
    const context = 'GET /api/zendesk/users';
    try {
      if (!isZendeskConfigured()) return notConfigured(context);

      const ids = (req.nextUrl.searchParams.get('ids') ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);

      if (!ids.length) return NextResponse.json({ success: true, users: [] });

      const users = await getUsers(ids);
      return NextResponse.json({ success: true, users });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  { permission: 'integrations.zendesk' },
);
