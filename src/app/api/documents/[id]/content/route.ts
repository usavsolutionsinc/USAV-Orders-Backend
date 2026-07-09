import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { OutboundDocumentData } from '@/lib/documents/types';
import { getStorageAdapter } from '@/lib/photos/storage/registry';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';

export const dynamic = 'force-dynamic';

const TTL = Number(process.env.PHOTOS_SIGNED_URL_TTL_SECONDS || 3600);

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isSameOriginPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.view');
  if (gate.denied) return gate.denied;

  const { id: rawId } = await params;
  const documentId = parseId(rawId);
  if (documentId === null) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }

  const orgId = gate.ctx.organizationId as OrgId;
  const download = new URL(req.url).searchParams.get('download') === '1';

  try {
    const res = await tenantQuery<{ document_data: OutboundDocumentData }>(
      orgId,
      `SELECT document_data FROM documents WHERE id = $1 AND organization_id = $2`,
      [documentId, orgId],
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const data = res.rows[0].document_data ?? ({} as OutboundDocumentData);
    const mimeType = data.mimeType || 'application/pdf';
    const filename = data.filename || `document-${documentId}`;

    if (data.storageProvider === 'gcs' && data.bucket && data.objectKey) {
      try {
        const adapter = getStorageAdapter('gcs');
        if (download) {
          const bytes = await adapter.getObjectBytes({
            bucket: data.bucket,
            objectKey: data.objectKey,
          });
          return new NextResponse(Buffer.from(bytes), {
            headers: {
              'content-type': mimeType,
              'content-disposition': `attachment; filename="${filename}"`,
              'cache-control': 'private, max-age=300',
            },
          });
        }
        const signed = await adapter.getSignedReadUrl({
          bucket: data.bucket,
          objectKey: data.objectKey,
          ttlSeconds: TTL,
        });
        return NextResponse.redirect(signed, { status: 302 });
      } catch {
        /* fall through to legacy URL */
      }
    }

    const url = data.url;
    if (!url) {
      return NextResponse.json({ error: 'Document has no stored content' }, { status: 404 });
    }

    if (isSameOriginPath(url)) {
      return NextResponse.json({ error: 'Document content unavailable' }, { status: 404 });
    }

    const display = normalizePhotoDisplayUrl(url);
    if (display.startsWith('http') || display.startsWith('/')) {
      return NextResponse.redirect(display, { status: 302 });
    }

    return NextResponse.json({ error: 'Document content unavailable' }, { status: 404 });
  } catch (error) {
    console.error('Error in GET /api/documents/[id]/content:', error);
    return NextResponse.json({ error: 'Failed to load document content' }, { status: 500 });
  }
}
