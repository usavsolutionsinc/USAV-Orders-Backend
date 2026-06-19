import type { PhotoEntityType } from '../types';

/** Build GCS object keys under `{org}/{flow}/…/{photoId}.jpg`. */
export function buildGcsObjectKey(opts: {
  organizationId: string;
  entityType: PhotoEntityType;
  photoId: number;
  poRef?: string | null;
  unitUid?: string | null;
  now?: Date;
}): { objectKey: string; thumbObjectKey: string } {
  const now = opts.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safePo = sanitizePathSegment(opts.poRef || 'unknown');
  const baseName = `${opts.photoId}.jpg`;
  const thumbName = `${opts.photoId}_thumb.jpg`;

  let segment: string;
  switch (opts.entityType) {
    case 'RECEIVING':
    case 'RECEIVING_LINE':
      segment = `receiving/${yyyy}/${mm}/PO-${safePo}/${baseName}`;
      break;
    case 'PACKER_LOG':
      segment = `packing/${yyyy}/${mm}/PO-${safePo}/${baseName}`;
      break;
    case 'SERIAL_UNIT':
      segment = `serial-units/${sanitizePathSegment(opts.unitUid || String(opts.photoId))}/${baseName}`;
      break;
    default:
      segment = `misc/${yyyy}/${mm}/${baseName}`;
      break;
  }

  const prefix = opts.organizationId;
  const objectKey = `${prefix}/${segment}`;
  const thumbSegment = segment.replace(/\.jpg$/i, '_thumb.jpg');
  return { objectKey, thumbObjectKey: `${prefix}/${thumbSegment}` };
}

function sanitizePathSegment(raw: string): string {
  return raw
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'unknown';
}
