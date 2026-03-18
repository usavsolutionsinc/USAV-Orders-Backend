/**
 * Builds a URL by appending query params, filtering out null/undefined values.
 * @example buildUrl('/api/orders', { status: 'open', page: 1 }) → '/api/orders?status=open&page=1'
 */
export function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}

/**
 * Parses a query string into a key-value record.
 * @example parseQuery('?page=1&status=open') → { page: '1', status: 'open' }
 */
export function parseQuery(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return Object.fromEntries(params.entries());
}

/**
 * Returns the value of a single query param from a URL search string.
 */
export function getQueryParam(search: string, key: string): string | null {
  return new URLSearchParams(search).get(key);
}

/**
 * Joins URL path segments, normalising slashes.
 * @example joinPath('/api', 'orders/', '/42') → '/api/orders/42'
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s, i) => {
      if (i === 0) return s.replace(/\/+$/, '');
      return s.replace(/^\/+/, '').replace(/\/+$/, '');
    })
    .filter(Boolean)
    .join('/');
}

/**
 * Checks if a string is a valid absolute URL.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
