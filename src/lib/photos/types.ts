/** Shared photo platform types — entity linkage, storage, and API contracts. */

export const PHOTO_ENTITY_TYPES = [
  'RECEIVING',
  'RECEIVING_LINE',
  'PACKER_LOG',
  'SERIAL_UNIT',
  'SKU',
  'SKU_STOCK',
  'BIN_ADJUSTMENT',
  'SHARE_PACK',
  'ZENDESK_TICKET',
] as const;

export type PhotoEntityType = (typeof PHOTO_ENTITY_TYPES)[number];

export const PHOTO_LINK_ROLES = ['primary', 'claim_evidence', 'insurance_share'] as const;
export type PhotoLinkRole = (typeof PHOTO_LINK_ROLES)[number];

export const PHOTO_STORAGE_PROVIDERS = [
  'gcs',
  'vercel_blob',
  'nas',
  'legacy_url',
  's3',
  'r2',
  'google_drive',
] as const;

export type PhotoStorageProvider = (typeof PHOTO_STORAGE_PROVIDERS)[number];

export interface PhotoRecord {
  id: number;
  organizationId: string;
  photoType: string | null;
  takenByStaffId: number | null;
  poRef: string | null;
  url: string | null;
  createdAt: string;
}

export interface PhotoListItem extends PhotoRecord {
  /** Resolved display URL — content route or legacy normalized URL. */
  displayUrl: string;
  thumbUrl: string;
}

export interface UploadPhotoInput {
  organizationId: string;
  staffId: number;
  entityType: PhotoEntityType;
  entityId: number;
  photoType?: string | null;
  linkRole?: PhotoLinkRole;
  poRef?: string | null;
  fileBuffer: Buffer;
  contentType: string;
  /** When false, skip GCS and use legacy URL-only insert (migration period). */
  useStorageAdapter?: boolean;
  /** Legacy NAS/Blob URL when not uploading bytes server-side. */
  legacyUrl?: string | null;
}

export interface UploadPhotoResult {
  id: number;
  url: string;
  thumbUrl: string;
}
