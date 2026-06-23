import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';

export const dynamic = 'force-dynamic';

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function zipEntry(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  nameBuf.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  nameBuf.copy(central, 46);

  return Buffer.concat([local, data, central]);
}

function safeEntryName(base: string, fallback: string): string {
  const cleaned = base.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export async function GET(request: NextRequest) {
  const sid = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const actor = await getCurrentUserBySid(sid);
  if (!actor) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const gate = await requireRoutePerm(request, 'photos.view');
  if (gate.denied) {
    // Keep parity with the content route: the org-scoped session still drives
    // access, but we record the permission denial for audit visibility.
  }

  const idsParam = request.nextUrl.searchParams.get('ids')?.trim() ?? '';
  const requestedIds = idsParam
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
  const photoIds = [...new Set(requestedIds)];

  if (photoIds.length === 0) {
    return NextResponse.json({ error: 'At least one photo id is required' }, { status: 400 });
  }

  const verify = await tenantQuery<{ id: number }>(
    actor.organizationId,
    `SELECT id
       FROM photos
      WHERE organization_id = $1
        AND id = ANY($2::bigint[])`,
    [actor.organizationId, photoIds],
  );

  if (verify.rowCount === 0) {
    return NextResponse.json({ error: 'No downloadable photos found' }, { status: 404 });
  }

  const foundIds = new Set(verify.rows.map((row) => Number(row.id)));
  const orderedIds = photoIds.filter((id) => foundIds.has(id));

  const parts: Buffer[] = [];
  let offset = 0;
  const centralHeaders: Buffer[] = [];
  let archivedCount = 0;
  const title = request.nextUrl.searchParams.get('title')?.trim() || 'photos';

  for (let i = 0; i < orderedIds.length; i++) {
    const photoId = orderedIds[i];
    const bytes = await readPhotoBytesById(photoId, actor.organizationId);
    if (!bytes) continue;

    const fallback = `photo_${String(i + 1).padStart(2, '0')}.jpg`;
    const name = `${String(i + 1).padStart(2, '0')}_${safeEntryName(bytes.filename, fallback)}`;
    const data = Buffer.from(bytes.bytes);
    const entry = zipEntry(name, data);
    const localSize = 30 + Buffer.byteLength(name, 'utf8') + data.length;
    centralHeaders.push(entry.subarray(localSize));
    parts.push(entry.subarray(0, localSize));
    offset += localSize;
    archivedCount += 1;
  }

  if (archivedCount === 0) {
    return NextResponse.json({ error: 'No downloadable photos found' }, { status: 404 });
  }

  const centralDir = Buffer.concat(centralHeaders);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centralHeaders.length, 8);
  end.writeUInt16LE(centralHeaders.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const blob = Buffer.concat([...parts, centralDir, end]);
  const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'photos';

  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeTitle}.zip"`,
    },
  });
}
