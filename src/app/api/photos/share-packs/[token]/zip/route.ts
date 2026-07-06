import { NextRequest, NextResponse } from 'next/server';
import { getSharePackByToken } from '@/lib/photos/share-packs';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';
import { buildStoreZip, type StoreZipEntry } from '@/lib/zip/store-zip';

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

  const entries: StoreZipEntry[] = [];
  for (const photo of pack.photos) {
    const bytes = await readPhotoBytesById(photo.id, orgId);
    if (!bytes) continue;
    entries.push({ name: photo.exportFilename || bytes.filename, data: Buffer.from(bytes.bytes) });
  }

  const blob = buildStoreZip(entries);
  const safeTitle = (pack.pack?.title || 'photos').replace(/[^\w.-]+/g, '_').slice(0, 40);

  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeTitle}.zip"`,
    },
  });
}
