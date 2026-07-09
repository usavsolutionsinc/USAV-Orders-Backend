import { NextRequest, NextResponse } from 'next/server';
import { getSharePackByToken } from '@/lib/photos/share-packs';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';
import { buildStoreZip, type StoreZipEntry } from '@/lib/zip/store-zip';
import {
  safeZipDownloadBasename,
  safeZipEntryName,
  uniquifyZipEntryNames,
  zipAttachmentHeaders,
} from '@/lib/zip/safe-entry-name';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const pack = await getSharePackByToken(token.trim());
  if (!pack) {
    return NextResponse.json({ error: 'Share pack not found' }, { status: 404 });
  }
  if (pack.expired) {
    return NextResponse.json({ error: 'Share pack expired' }, { status: 410 });
  }

  const orgId = pack.organizationId;
  if (!orgId) {
    return NextResponse.json({ error: 'Share pack not found' }, { status: 404 });
  }

  const rawEntries: StoreZipEntry[] = [];
  for (const photo of pack.photos) {
    const bytes = await readPhotoBytesById(photo.id, orgId);
    if (!bytes) continue;
    const fallback = `photo_${photo.id}.jpg`;
    const name = safeZipEntryName(photo.exportFilename || bytes.filename, fallback);
    rawEntries.push({ name, data: Buffer.from(bytes.bytes) });
  }

  if (rawEntries.length === 0) {
    return NextResponse.json({ error: 'No downloadable photos found' }, { status: 404 });
  }

  const uniqueNames = uniquifyZipEntryNames(rawEntries.map((e) => e.name));
  const entries = rawEntries.map((entry, i) => ({ ...entry, name: uniqueNames[i] }));
  const blob = buildStoreZip(entries);
  const safeTitle = safeZipDownloadBasename(pack.pack?.title || 'photos', 'photos');

  return new NextResponse(blob, {
    headers: zipAttachmentHeaders(safeTitle, blob.length),
  });
}
