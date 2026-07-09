/**
 * Receiving photo intent — which surface captured the shot.
 *
 * Triage (door): exterior / package condition (`receiving_package`).
 * Unbox (bench): item interior after open (`receiving_item`).
 *
 * Legacy rows used `receiving` / `receiving_item` interchangeably; filters
 * treat both package aliases as box shots.
 */

export const RECEIVING_PHOTO_PACKAGE = 'receiving_package' as const;
export const RECEIVING_PHOTO_ITEM = 'receiving_item' as const;

/** Legacy carton-level type written before package/item split. */
export const RECEIVING_PHOTO_LEGACY_PACKAGE = 'receiving' as const;

export type ReceivingPhotoIntent = typeof RECEIVING_PHOTO_PACKAGE | typeof RECEIVING_PHOTO_ITEM;

export function isPackagePhotoType(photoType: string | null | undefined): boolean {
  const t = String(photoType ?? '').trim().toLowerCase();
  return t === RECEIVING_PHOTO_PACKAGE || t === RECEIVING_PHOTO_LEGACY_PACKAGE;
}

export function isItemPhotoType(photoType: string | null | undefined): boolean {
  return String(photoType ?? '').trim().toLowerCase() === RECEIVING_PHOTO_ITEM;
}
