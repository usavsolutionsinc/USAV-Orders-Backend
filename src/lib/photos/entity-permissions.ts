import type { PermissionString } from '@/lib/auth/permissions-shared';
import type { PhotoEntityType } from './types';

/** Upload/delete permission for each photo entity type. */
export const UPLOAD_PERM_BY_ENTITY: Record<PhotoEntityType, PermissionString> = {
  RECEIVING: 'receiving.upload_photo',
  RECEIVING_LINE: 'receiving.upload_photo',
  PACKER_LOG: 'packing.complete_order',
  SERIAL_UNIT: 'tech.scan_serial',
  SKU: 'receiving.upload_photo',
  SKU_STOCK: 'sku_stock.adjust',
  BIN_ADJUSTMENT: 'bin.adjust',
  SHARE_PACK: 'photos.share',
  ZENDESK_TICKET: 'integrations.zendesk',
};

export function uploadPermissionFor(entityType: PhotoEntityType): PermissionString {
  return UPLOAD_PERM_BY_ENTITY[entityType];
}
