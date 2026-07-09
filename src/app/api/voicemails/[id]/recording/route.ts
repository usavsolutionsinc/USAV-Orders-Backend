import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getVoicemailRecordingSource } from '@/lib/voice/voicemail-queries';
import { fetchRecording, NextivaNotConfiguredError } from '@/lib/voice/nextiva/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/voicemails/:id/recording — server-side proxy for the voicemail audio.
 * Never exposes the Nextiva URL / API key to the browser. Streams the bytes
 * (or, once archival lands, redirects to a private Blob signed URL).
 */

function voicemailIdFromUrl(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const i = segs.lastIndexOf('recording');
  const id = Number(decodeURIComponent(segs[i - 1] || ''));
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('A valid numeric voicemail id is required');
  return id;
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const id = voicemailIdFromUrl(req);
      const src = await getVoicemailRecordingSource(ctx.organizationId, id);
      if (!src) throw ApiError.notFound('Voicemail', id);
      if (!src.recordingUrl && !src.blobKey) throw ApiError.notFound('Recording for voicemail', id);

      // TODO(spike §6): when src.blobKey is set, redirect to a private Blob
      // signed URL instead of proxying through Nextiva.
      if (!src.recordingUrl) {
        return NextResponse.json({ error: 'Recording archival not yet wired' }, { status: 501 });
      }

      const { body, contentType } = await fetchRecording(ctx.organizationId, src.recordingUrl);
      if (!body) throw ApiError.notFound('Recording stream for voicemail', id);

      return new NextResponse(body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'private, max-age=300',
        },
      });
    } catch (err) {
      if (err instanceof NextivaNotConfiguredError) {
        return NextResponse.json({ error: 'NEXTIVA_NOT_CONNECTED' }, { status: 501 });
      }
      return errorResponse(err, 'GET /api/voicemails/[id]/recording');
    }
  },
  { permission: 'integrations.zendesk' },
);
