import { createHash } from 'node:crypto';
import { defaultGcsBucket, gcsAdapter, isGcsConfigured } from '@/lib/photos/storage/gcs-adapter';
import { buildOutboundDocumentPath } from '@/lib/documents/storage-paths';
import type { OutboundDocumentType } from '@/lib/documents/types';
import type { OrgId } from '@/lib/tenancy/constants';
import { getOrganization } from '@/lib/tenancy/organizations';

export interface UploadOutboundDocumentInput {
  organizationId: OrgId;
  documentId: number;
  documentType: OutboundDocumentType;
  platform: string;
  orderRef: string;
  trackingTail?: string | null;
  buffer: Buffer;
  contentType: string;
  extension?: string;
}

export interface UploadOutboundDocumentResult {
  bucket: string;
  objectKey: string;
  sha256Hex: string;
  fileSizeBytes: number;
}

export function isOutboundDocumentGcsConfigured(): boolean {
  return isGcsConfigured();
}

/** Write outbound document bytes to the org's GCS prefix. */
export async function uploadOutboundDocumentToGcs(
  input: UploadOutboundDocumentInput,
): Promise<UploadOutboundDocumentResult> {
  if (!isGcsConfigured()) {
    throw new Error('GCS storage is not configured');
  }

  const org = await getOrganization(input.organizationId);
  const orgSlug = org?.slug?.trim() || input.organizationId;
  const objectKey = buildOutboundDocumentPath(
    {
      orgSlug,
      documentType: input.documentType,
      platform: input.platform,
      orderRef: input.orderRef,
      trackingTail: input.trackingTail,
      documentId: input.documentId,
      extension: input.extension,
    },
    new Date(),
  );

  const bucket = defaultGcsBucket();
  const sha256Hex = createHash('sha256').update(input.buffer).digest('hex');

  await gcsAdapter.putObject({
    organizationId: input.organizationId,
    bucket,
    objectKey,
    buffer: input.buffer,
    contentType: input.contentType,
  });

  return {
    bucket,
    objectKey,
    sha256Hex,
    fileSizeBytes: input.buffer.length,
  };
}
