import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getVoicemail } from '@/lib/voice/voicemail-queries';

export const dynamic = 'force-dynamic';

/** GET /api/voicemails/:id → VoicemailDetailDTO (404 if not in this org). */

function idFromUrl(req: NextRequest, anchor: string): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const i = anchor === 'last' ? segs.length - 1 : segs.lastIndexOf(anchor) - 1;
  const id = Number(decodeURIComponent(segs[i] || ''));
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('A valid numeric voicemail id is required');
  return id;
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const id = idFromUrl(req, 'last');
      const vm = await getVoicemail(ctx.organizationId, id);
      if (!vm) throw ApiError.notFound('Voicemail', id);
      return NextResponse.json(vm);
    } catch (err) {
      return errorResponse(err, 'GET /api/voicemails/[id]');
    }
  },
  { permission: 'integrations.zendesk' },
);
