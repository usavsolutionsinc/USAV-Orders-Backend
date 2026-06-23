export function buildPhotoZipDownloadUrl(
  photoIds: Array<number | null | undefined>,
  title?: string | null,
): string | null {
  const ids = [
    ...new Set(
      photoIds.filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0),
    ),
  ];
  if (ids.length === 0) return null;

  const params = new URLSearchParams({ ids: ids.join(',') });
  const safeTitle = title?.trim();
  if (safeTitle) {
    params.set('title', safeTitle);
  }
  return `/api/photos/download-zip?${params.toString()}`;
}

export function triggerBrowserDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
