import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import type { OrgId } from '@/lib/tenancy/constants';
import { readOutboundDocumentBytes } from '@/lib/documents/read-bytes';
import { buildStoreZip, type StoreZipEntry } from '@/lib/zip/store-zip';
import {
  safeZipDownloadBasename,
  safeZipEntryName,
  uniquifyZipEntryNames,
  zipAttachmentHeaders,
} from '@/lib/zip/safe-entry-name';

export const dynamic = 'force-dynamic';

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

  const rawEntries: StoreZipEntry[] = [];
  for (let i = 0; i < documentIds.length; i++) {
    const documentId = documentIds[i];
    const file = await readOutboundDocumentBytes(orgId, documentId);
    if (!file) continue;

    const name = `${String(i + 1).padStart(2, '0')}_${safeZipEntryName(file.filename, `document-${documentId}.pdf`)}`;
    rawEntries.push({ name, data: file.bytes });
  }

  if (rawEntries.length === 0) {
    return NextResponse.json({ error: 'No downloadable documents found' }, { status: 404 });
  }

  const uniqueNames = uniquifyZipEntryNames(rawEntries.map((e) => e.name));
  const entries = rawEntries.map((entry, i) => ({ ...entry, name: uniqueNames[i] }));
  const blob = buildStoreZip(entries);
  const safeTitle = safeZipDownloadBasename(title, 'outbound-documents');

  return new NextResponse(blob, {
    headers: zipAttachmentHeaders(safeTitle, blob.length),
  });
}
