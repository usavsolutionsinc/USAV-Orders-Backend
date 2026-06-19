import { createHash } from 'node:crypto';
import type { PhotoStorageAdapter, PutObjectInput, PutObjectResult, SignedUrlInput } from './types';

let storageClient: import('@google-cloud/storage').Storage | null = null;

function getStorage(): import('@google-cloud/storage').Storage {
  if (storageClient) return storageClient;
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (json) {
    const credentials = JSON.parse(json) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Storage } = require('@google-cloud/storage') as typeof import('@google-cloud/storage');
    storageClient = new Storage({
      projectId: process.env.PHOTOS_GCS_PROJECT_ID || (credentials.project_id as string),
      credentials,
    });
    return storageClient;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Storage } = require('@google-cloud/storage') as typeof import('@google-cloud/storage');
  storageClient = new Storage({
    projectId: process.env.PHOTOS_GCS_PROJECT_ID,
  });
  return storageClient;
}

export function isGcsConfigured(): boolean {
  return Boolean(
    process.env.PHOTOS_GCS_BUCKET?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim(),
  );
}

export function defaultGcsBucket(): string {
  return process.env.PHOTOS_GCS_BUCKET?.trim() || 'usav-photos-dev';
}

export const gcsAdapter: PhotoStorageAdapter = {
  provider: 'gcs',

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const storage = getStorage();
    const bucket = storage.bucket(input.bucket);
    const sha256Hex = createHash('sha256').update(input.buffer).digest('hex');

    await bucket.file(input.objectKey).save(input.buffer, {
      contentType: input.contentType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=3600' },
    });

    if (input.thumbBuffer && input.thumbObjectKey) {
      await bucket.file(input.thumbObjectKey).save(input.thumbBuffer, {
        contentType: 'image/jpeg',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=3600' },
      });
    }

    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      thumbObjectKey: input.thumbObjectKey ?? null,
      fileSizeBytes: input.buffer.length,
      sha256Hex,
    };
  },

  async getSignedReadUrl(input: SignedUrlInput): Promise<string> {
    const storage = getStorage();
    const [url] = await storage.bucket(input.bucket).file(input.objectKey).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + input.ttlSeconds * 1000,
    });
    return url;
  },

  async getObjectBytes(input: { bucket: string; objectKey: string }): Promise<Buffer> {
    const storage = getStorage();
    const [buf] = await storage.bucket(input.bucket).file(input.objectKey).download();
    return buf;
  },

  async deleteObject(input: { bucket: string; objectKey: string }): Promise<void> {
    const storage = getStorage();
    await storage.bucket(input.bucket).file(input.objectKey).delete({ ignoreNotFound: true });
  },
};
