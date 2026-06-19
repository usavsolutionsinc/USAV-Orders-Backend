import type { PhotoEntityType } from './types';

export interface ClientUploadInput {
  file: Blob | File;
  entityType: PhotoEntityType;
  entityId: number;
  photoType?: string;
  linkRole?: 'primary' | 'claim_evidence' | 'insurance_share';
  poRef?: string;
}

export interface ClientUploadResult {
  id: number;
  url: string;
  thumbUrl: string;
}

/** Browser multipart upload to the unified photos endpoint. */
export async function uploadPhotoClient(input: ClientUploadInput): Promise<ClientUploadResult> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('entityType', input.entityType);
  form.append('entityId', String(input.entityId));
  if (input.photoType) form.append('photoType', input.photoType);
  if (input.linkRole) form.append('linkRole', input.linkRole);
  if (input.poRef) form.append('poRef', input.poRef);

  const res = await fetch('/api/photos/upload', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as ClientUploadResult & { error?: string };
  if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
  return data;
}

export async function linkPhotoClient(input: {
  photoId: number;
  entityType: PhotoEntityType;
  entityId: number;
  linkRole: 'primary' | 'claim_evidence' | 'insurance_share';
}): Promise<void> {
  const res = await fetch('/api/photos/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `Link failed (${res.status})`);
  }
}
