import 'server-only';

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { OutboundDocumentData } from '@/lib/documents/types';
import { getStorageAdapter } from '@/lib/photos/storage/registry';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';

export interface DocumentBytesResult {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

export async function readOutboundDocumentBytes(
  orgId: OrgId,
  documentId: number,
): Promise<DocumentBytesResult | null> {
  const res = await tenantQuery<{ document_type: string; document_data: OutboundDocumentData }>(
    orgId,
    `SELECT document_type, document_data FROM documents WHERE id = $1 AND organization_id = $2`,
    [documentId, orgId],
  );
  if (res.rowCount === 0) return null;

  const row = res.rows[0];
  const data = row.document_data ?? ({} as OutboundDocumentData);
  const ext = data.mimeType === 'image/png' ? 'png' : 'pdf';
  const filename = data.filename?.trim() || `${row.document_type}-${documentId}.${ext}`;

  if (data.storageProvider === 'gcs' && data.bucket && data.objectKey) {
    try {
      const adapter = getStorageAdapter('gcs');
      const bytes = await adapter.getObjectBytes({ bucket: data.bucket, objectKey: data.objectKey });
      return { bytes, contentType: data.mimeType || 'application/pdf', filename };
    } catch {
      /* fall through */
    }
  }

  const url = data.url?.trim();
  if (!url || url.startsWith('/api/')) return null;

  const display = normalizePhotoDisplayUrl(url);
  if (!display.startsWith('http')) return null;

  const response = await fetch(display);
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: data.mimeType || response.headers.get('content-type') || 'application/pdf',
    filename,
  };
}
