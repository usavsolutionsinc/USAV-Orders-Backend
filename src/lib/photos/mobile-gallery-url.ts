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

/** Same route as capture with `?mode=gallery` (legacy `/gallery` paths redirect here). */
export function receivingPhotosGalleryUrl(photosPath: string): string {
  const [path, existing] = photosPath.split('?');
  const search = new URLSearchParams(existing ?? '');
  search.set('mode', 'gallery');
  return `${path}?${search}`;
}
