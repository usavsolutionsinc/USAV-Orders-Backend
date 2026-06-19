import type { PhotoStorageProvider } from '../types';
import type { PhotoStorageAdapter } from './types';
import { gcsAdapter } from './gcs-adapter';
import { legacyAdapter } from './legacy-adapter';

const ADAPTERS: Partial<Record<PhotoStorageProvider, PhotoStorageAdapter>> = {
  gcs: gcsAdapter,
  legacy_url: legacyAdapter,
};

export function getStorageAdapter(provider: PhotoStorageProvider): PhotoStorageAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No storage adapter registered for provider: ${provider}`);
  return adapter;
}

export function isAdapterUploadEnabled(): boolean {
  const mode = (process.env.PHOTOS_UPLOAD_PROVIDER || 'adapter').toLowerCase();
  return mode !== 'legacy';
}
