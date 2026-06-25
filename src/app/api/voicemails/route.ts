import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { listVoicemails, type VoicemailStatusFilter } from '@/lib/voice/voicemail-queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/voicemails?status=open|snoozed|done|all&q=&assignee=
 *   → { items: VoicemailListItemDTO[], openCount }
 *
 * The Voicemail Workbench picker. Org-scoped by construction (tenantQuery GUC).
 */

function parseStatus(raw: string | null): VoicemailStatusFilter {
  return raw === 'snoozed' || raw === 'done' || raw === 'all' ? raw : 'open';
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const assigneeRaw = sp.get('assignee');
      const assignedStaffId = assigneeRaw && Number.isFinite(Number(assigneeRaw)) ? Number(assigneeRaw) : null;
      const result = await listVoicemails(ctx.organizationId, {
        status: parseStatus(sp.get('status')),
        query: sp.get('q'),
        assignedStaffId,
      });
      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err, 'GET /api/voicemails');
    }
  },
  { permission: 'integrations.zendesk' },
);
