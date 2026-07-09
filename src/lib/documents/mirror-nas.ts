import pool from '@/lib/db';
import { readOutboundDocumentBytes } from '@/lib/documents/read-bytes';
import type { OutboundDocumentData, OutboundDocumentType } from '@/lib/documents/types';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getNasStorageTarget } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';

const MIRROR_AFTER_DAYS = Number(process.env.DOCUMENTS_NAS_MIRROR_AFTER_DAYS || process.env.PHOTOS_NAS_MIRROR_AFTER_DAYS || 90);

function buildShippingNasRelativePath(opts: {
  folder: string;
  orderRef: string;
  filename: string;
  kindPrefix: string;
}): string {
  const sanitized = (opts.orderRef ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefix = `${opts.kindPrefix}_${sanitized || 'order'}__`;
  const segments: string[] = [];
  const cleanFolder = (opts.folder || '').replace(/^\/+|\/+$/g, '');
  if (cleanFolder) segments.push(...cleanFolder.split('/'));
  segments.push(`${prefix}${opts.filename}`);
  return segments.join('/');
}

export function isDocumentNasMirrorConfigured(): boolean {
  return Boolean(process.env.NAS_AGENT_URL?.trim() && process.env.NAS_AGENT_TOKEN?.trim());
}

async function putToNasShippingAgent(opts: {
  relativePath: string;
  bytes: Buffer;
  contentType: string;
}): Promise<string> {
  const base = (process.env.NAS_AGENT_URL || '').replace(/\/+$/, '');
  const token = process.env.NAS_AGENT_TOKEN || '';
  const url = `${base}/file/shipping/${opts.relativePath.split('/').map(encodeURIComponent).join('/')}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': opts.contentType,
      'x-agent-token': token,
    },
    body: new Uint8Array(opts.bytes),
  });
  if (!res.ok) throw new Error(`NAS agent PUT failed (${res.status})`);
  return `/api/nas-target/shipping/${opts.relativePath}`;
}

/** Copy a GCS-primary outbound document to NAS cold storage (updates document_data). */
export async function mirrorOutboundDocumentToNas(input: {
  documentId: number;
  organizationId: OrgId;
}): Promise<{ nasUrl: string }> {
  const meta = await pool.query<{
    document_type: OutboundDocumentType;
    document_data: OutboundDocumentData;
    order_ref: string | null;
  }>(
    `SELECT d.document_type, d.document_data,
            (SELECT o.order_id FROM document_entity_links l
               JOIN orders o ON o.id = l.entity_id AND o.organization_id = d.organization_id
              WHERE l.document_id = d.id AND l.entity_type = 'ORDER'
              LIMIT 1) AS order_ref
       FROM documents d
      WHERE d.id = $1 AND d.organization_id = $2`,
    [input.documentId, input.organizationId],
  );
  const row = meta.rows[0];
  if (!row) throw new Error('Document not found');

  const data = row.document_data ?? ({} as OutboundDocumentData);
  if (data.storageProvider !== 'gcs' || !data.bucket || !data.objectKey) {
    throw new Error('Document has no GCS primary storage');
  }
  if (data.nasUrl?.trim()) {
    throw new Error('NAS mirror already exists');
  }

  const bytes = await readOutboundDocumentBytes(input.organizationId, input.documentId);
  if (!bytes) throw new Error('Document bytes unreadable');

  const org = await getOrganization(input.organizationId);
  if (!org) throw new Error('Organization not found');

  const { folder } = getNasStorageTarget(org.settings, 'shipping');
  const orderRef = (row.order_ref ?? 'order').trim();
  const kindPrefix = row.document_type === 'packing_slip' ? 'SLIP' : 'LABEL';
  const filename = bytes.filename.trim() || `${row.document_type}-${input.documentId}.pdf`;

  const relativePath = buildShippingNasRelativePath({
    folder,
    orderRef,
    filename,
    kindPrefix,
  });

  let nasUrl: string;
  if (isDocumentNasMirrorConfigured()) {
    nasUrl = await putToNasShippingAgent({
      relativePath,
      bytes: bytes.bytes,
      contentType: bytes.contentType,
    });
  } else if (process.env.NAS_DEV_ROOT) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const target = join(process.env.NAS_DEV_ROOT, 'shipping', relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes.bytes);
    nasUrl = `/api/nas-dev/shipping/${relativePath}`;
  } else {
    throw new Error('NAS agent or NAS_DEV_ROOT not configured');
  }

  const patched: OutboundDocumentData = {
    ...data,
    nasUrl,
    nasObjectKey: relativePath,
    nasMirroredAt: new Date().toISOString(),
  };

  await pool.query(
    `UPDATE documents SET document_data = $1::jsonb, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3`,
    [JSON.stringify(patched), input.documentId, input.organizationId],
  );

  return { nasUrl };
}

export async function selectDocumentsForNasMirror(
  limit: number,
  opts?: { organizationId?: string; skipAgeGate?: boolean },
): Promise<Array<{ documentId: number; organizationId: string }>> {
  const params: unknown[] = [limit];
  const orgClause = opts?.organizationId
    ? (params.push(opts.organizationId), `AND d.organization_id = $${params.length}`)
    : '';
  const ageClause = opts?.skipAgeGate
    ? ''
    : (params.push(MIRROR_AFTER_DAYS), `AND d.created_at < NOW() - ($${params.length}::int * INTERVAL '1 day')`);

  const res = await pool.query<{ id: string; organization_id: string }>(
    `SELECT d.id, d.organization_id
       FROM documents d
       JOIN organizations o ON o.id = d.organization_id
      WHERE d.document_type IN ('shipping_label', 'packing_slip')
        AND d.document_data->>'storageProvider' = 'gcs'
        AND d.document_data->>'bucket' IS NOT NULL
        AND d.document_data->>'objectKey' IS NOT NULL
        AND (d.document_data->>'nasUrl' IS NULL OR d.document_data->>'nasUrl' = '')
        AND COALESCE(o.settings->>'shipping.nasBackup', o.settings->>'receiving.nasBackup', 'mirror') <> 'off'
        ${ageClause}
        ${orgClause}
      ORDER BY d.created_at ASC
      LIMIT $1`,
    params,
  );

  return res.rows.map((r) => ({
    documentId: Number(r.id),
    organizationId: r.organization_id,
  }));
}

export async function runOutboundDocumentNasMirrorBatch(limit: number): Promise<{
  candidates: number;
  completed: number;
  failed: number;
}> {
  const candidates = await selectDocumentsForNasMirror(limit);
  let completed = 0;
  let failed = 0;

  for (const row of candidates) {
    try {
      await mirrorOutboundDocumentToNas({
        documentId: row.documentId,
        organizationId: row.organizationId as OrgId,
      });
      completed++;
    } catch {
      failed++;
    }
  }

  return { candidates: candidates.length, completed, failed };
}
