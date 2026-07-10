import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { isZendeskConfiguredForOrg, listAgents, ZendeskApiError, ZendeskNotConfiguredError } from '@/lib/zendesk';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zendesk/agents
 * Lists assignable Zendesk agents + admins for the assignee dropdown.
 * Server-side cached (5 min) in the lib — the roster rarely changes.
 */

function notConfigured(context: string): NextResponse {
  return errorResponse(
    new ApiError(503, 'Zendesk is not configured', 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN.'),
    context,
  );
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'GET /api/zendesk/agents';
    try {
      if (!(await isZendeskConfiguredForOrg(ctx.organizationId))) return notConfigured(context);
      const force = req.nextUrl.searchParams.get('refresh') === '1';
      const agents = await listAgents(force, ctx.organizationId);
      return NextResponse.json({ success: true, agents });
    } catch (err) {
      if (err instanceof ZendeskNotConfiguredError) return notConfigured(context);
      if (err instanceof ZendeskApiError) {
        const status = err.status >= 400 && err.status < 600 ? err.status : 502;
        return errorResponse(new ApiError(status, 'Zendesk API error', err.message), context);
      }
      return errorResponse(err, context);
    }
  },
  { permission: 'integrations.zendesk', feature: 'support' },
);
