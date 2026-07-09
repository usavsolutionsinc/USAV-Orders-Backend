/** Client-safe outbound document content URL helpers. */

export function documentContentUrl(id: number, download?: boolean): string {
  const q = download ? '?download=1' : '';
  return `/api/documents/${id}/content${q}`;
}
