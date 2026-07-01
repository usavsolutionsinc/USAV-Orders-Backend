import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import type { OrgId } from '@/lib/tenancy/constants';
import { readOutboundDocumentBytes } from '@/lib/documents/read-bytes';

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

  const parts: Buffer[] = [];
  let offset = 0;
  const centralHeaders: Buffer[] = [];
  let archivedCount = 0;

  for (let i = 0; i < documentIds.length; i++) {
    const documentId = documentIds[i];
    const file = await readOutboundDocumentBytes(orgId, documentId);
    if (!file) continue;

    const name = `${String(i + 1).padStart(2, '0')}_${safeEntryName(file.filename, `document-${documentId}.pdf`)}`;
    const entry = zipEntry(name, file.bytes);
    const localSize = 30 + Buffer.byteLength(name, 'utf8') + file.bytes.length;
    centralHeaders.push(entry.subarray(localSize));
    parts.push(entry.subarray(0, localSize));
    offset += localSize;
    archivedCount += 1;
  }

  if (archivedCount === 0) {
    return NextResponse.json({ error: 'No downloadable documents found' }, { status: 404 });
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
  const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'outbound-documents';

  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeTitle}.zip"`,
    },
  });
}
