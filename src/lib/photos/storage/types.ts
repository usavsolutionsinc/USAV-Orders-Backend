import type { PhotoStorageProvider } from '../types';

export interface PhotoStorageRow {
  id: number;
  photoId: number;
  organizationId: string;
  provider: PhotoStorageProvider;
  bucket: string | null;
  objectKey: string;
  thumbObjectKey: string | null;
  contentType: string | null;
  fileSizeBytes: number | null;
  sha256Hex: string | null;
  legacyUrl: string | null;
  providerMeta: Record<string, unknown>;
  isPrimary: boolean;
}

export interface PutObjectInput {
  organizationId: string;
  bucket: string;
  objectKey: string;
  thumbObjectKey?: string | null;
  buffer: Buffer;
  thumbBuffer?: Buffer | null;
  contentType: string;
}

export interface PutObjectResult {
  bucket: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileSizeBytes: number;
  sha256Hex: string;
}

export interface SignedUrlInput {
  bucket: string;
  objectKey: string;
  ttlSeconds: number;
}

export interface StorageProviderConfig {
  provider: PhotoStorageProvider;
  bucket?: string;
  prefix?: string;
  credentialKey?: string;
}

export interface PhotoStorageAdapter {
  provider: PhotoStorageProvider;
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  getSignedReadUrl(input: SignedUrlInput): Promise<string>;
  getObjectBytes(input: { bucket: string; objectKey: string }): Promise<Buffer>;
  deleteObject(input: { bucket: string; objectKey: string }): Promise<void>;
}
