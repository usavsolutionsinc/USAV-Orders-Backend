/** Build a `/…/photos` URL with optional search params. */
export function receivingPhotosUrl(
  photosPath: string,
  params: Record<string, string | undefined> = {},
): string {
  const [path, existing] = photosPath.split('?');
  const search = new URLSearchParams(existing ?? '');
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Same route as capture with `?mode=gallery` — opens the swipe photo viewer. */
export function receivingPhotosGalleryUrl(photosPath: string): string {
  const [path, existing] = photosPath.split('?');
  const search = new URLSearchParams(existing ?? '');
  search.set('mode', 'gallery');
  return `${path}?${search}`;
}

interface ReceivingLinePhotoLinkInput {
  receivingId: number | null | undefined;
  lineId: number;
  itemName?: string | null;
  sku?: string | null;
  zohoItemId?: string | null;
  poRef?: string | null;
  /** Mobile return path appended as `back` on gallery links. */
  back?: string;
}

/** Capture + gallery URLs for a receiving line (mobile list, sheet, rows). */
export function receivingLinePhotoHrefs(input: ReceivingLinePhotoLinkInput) {
  const receivingId = input.receivingId;
  if (!receivingId) {
    return { captureHref: '#', galleryHref: '#' };
  }
  const cameraTitle =
    input.itemName || input.sku || input.zohoItemId || `Line #${input.lineId}`;
  const photosBase = `/m/r/${receivingId}/photos`;
  const shared = {
    title: cameraTitle,
    poRef: input.poRef?.trim() || undefined,
  };
  const captureHref = receivingPhotosUrl(photosBase, shared);
  const galleryHref = receivingPhotosGalleryUrl(
    receivingPhotosUrl(photosBase, { ...shared, back: input.back }),
  );
  return { captureHref, galleryHref };
}
