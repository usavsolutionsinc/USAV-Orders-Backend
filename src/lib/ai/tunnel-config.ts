import pool from '@/lib/db';

const CONFIG_KEY = 'tunnel_url';
const CACHE_TTL_MS = 60_000;

let cachedUrl: string | null = null;
let cacheExpiresAt = 0;

/**
 * Returns the chatbot backend's Cloudflare tunnel URL stored in the
 * `config` table (key = 'tunnel_url'). Result is cached in-process for
 * 60 seconds to avoid a DB round-trip on every chat message.
 *
 * Throws if the row is missing so callers get a clear 503 rather than
 * a cryptic "fetch failed" against an undefined URL.
 */
export async function getTunnelUrl(): Promise<string> {
  const now = Date.now();

  if (cachedUrl && now < cacheExpiresAt) {
    return cachedUrl;
  }

  const result = await pool.query<{ value: string }>(
    'SELECT value FROM config WHERE key = $1',
    [CONFIG_KEY]
  );

  const url = result.rows[0]?.value?.trim().replace(/\/$/, '');

  if (!url) {
    throw new Error(
      `Chatbot tunnel URL not configured. ` +
      `Insert a row into the config table: key='tunnel_url', value='https://your-tunnel.trycloudflare.com'`
    );
  }

  cachedUrl = url;
  cacheExpiresAt = now + CACHE_TTL_MS;

  return url;
}

/** Force the next call to re-read from the DB (useful after updating the URL). */
export function invalidateTunnelUrlCache(): void {
  cachedUrl = null;
  cacheExpiresAt = 0;
}
