import { NextRequest, NextResponse } from 'next/server';
import { getSharePackByToken, resolveSharePackOrganizationId } from '@/lib/photos/share-packs';
import { resolvePhotoAccessUrl } from '@/lib/photos/resolve-access-url';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token?.trim()) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const pack = await getSharePackByToken(token.trim());
  if (!pack) {
    return NextResponse.json({ error: 'Share pack not found' }, { status: 404 });
  }
  if (pack.expired) {
    return NextResponse.json({ error: 'Share pack expired' }, { status: 410 });
  }

  const orgId = pack.organizationId || (await resolveSharePackOrganizationId(token.trim()));
  if (!orgId) {
    return NextResponse.json({ error: 'Share pack not found' }, { status: 404 });
  }

  const origin = request.nextUrl.origin;
  const photos = await Promise.all(
    pack.photos.map(async (p) => ({
      id: p.id,
      exportFilename: p.exportFilename,
      sortOrder: p.sortOrder,
      contentUrl: await resolvePhotoAccessUrl(p.id, orgId, 'full', origin),
      thumbUrl: await resolvePhotoAccessUrl(p.id, orgId, 'thumb', origin),
    })),
  );

  return NextResponse.json({
    pack: pack.pack,
    photos,
    zipUrl: `/api/photos/share-packs/${token.trim()}/zip`,
  });
}
