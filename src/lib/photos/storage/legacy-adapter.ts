import { readPhotoBytes as readLegacyPhotoBytes } from '@/lib/receiving-claim-photos';
import type { PhotoStorageAdapter, PutObjectInput, PutObjectResult, SignedUrlInput } from './types';

/** Reads bytes from legacy_url — no cloud put/delete. */
export const legacyAdapter: PhotoStorageAdapter = {
  provider: 'legacy_url',

  async putObject(_input: PutObjectInput): Promise<PutObjectResult> {
    throw new Error('legacy_url adapter is read-only');
  },

  async getSignedReadUrl(_input: SignedUrlInput): Promise<string> {
    throw new Error('legacy_url adapter does not sign URLs');
  },

  async getObjectBytes(input: { bucket: string; objectKey: string }): Promise<Buffer> {
    // objectKey holds `_legacy_` sentinel; legacyUrl passed via bucket hack or caller uses readPhotoBytes directly
    void input.bucket;
    const url = input.objectKey.startsWith('http') || input.objectKey.startsWith('/')
      ? input.objectKey
      : '';
    if (!url) throw new Error('No legacy URL');
    const result = await readLegacyPhotoBytes(url);
    if (!result) throw new Error('Legacy photo unreadable');
    return Buffer.from(result.bytes);
  },

  async deleteObject(): Promise<void> {
    // Legacy files are not deleted from NAS/Blob by the platform delete route.
  },
};

export async function readLegacyUrlBytes(url: string): Promise<Buffer | null> {
  const result = await readLegacyPhotoBytes(url);
  return result ? Buffer.from(result.bytes) : null;
}
