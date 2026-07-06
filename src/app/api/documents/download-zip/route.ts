import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import type { OrgId } from '@/lib/tenancy/constants';
import { readOutboundDocumentBytes } from '@/lib/documents/read-bytes';
import { buildStoreZip, type StoreZipEntry } from '@/lib/zip/store-zip';

export const dynamic = 'force-dynamic';

function safeEntryName(base: string, fallback: string): string {
  const cleaned = base.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export async function GET(request: NextRequest) {
  const gate = await requireRoutePerm(request, 'orders.view');
  if (gate.denied) return gate.denied;

  const idsParam = request.nextUrl.searchParams.get('ids')?.trim() ?? '';
  const requestedIds = idsParam
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
  const documentIds = [...new Set(requestedIds)];

  if (documentIds.length === 0) {
    return NextResponse.json({ error: 'At least one document id is required' }, { status: 400 });
  }
  if (documentIds.length > 50) {
    return NextResponse.json({ error: 'Maximum 50 documents per ZIP' }, { status: 400 });
  }

  const orgId = gate.ctx.organizationId as OrgId;
  const title = request.nextUrl.searchParams.get('title')?.trim() || 'outbound-documents';

  const entries: StoreZipEntry[] = [];
  for (let i = 0; i < documentIds.length; i++) {
    const documentId = documentIds[i];
    const file = await readOutboundDocumentBytes(orgId, documentId);
    if (!file) continue;

    const name = `${String(i + 1).padStart(2, '0')}_${safeEntryName(file.filename, `document-${documentId}.pdf`)}`;
    entries.push({ name, data: file.bytes });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No downloadable documents found' }, { status: 404 });
  }

  const blob = buildStoreZip(entries);
  const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'outbound-documents';

  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeTitle}.zip"`,
    },
  });
}
