/**
 * Normalize stored photo URLs for browser display.
 *
 * Production browsers must load through the same-origin `/api/nas` proxy (session
 * cookie). Direct `https://nas-photos…` or dev-only `/api/nas-dev/` URLs fail
 * to render in PhotoGallery / <img> on Vercel.
 */

const NAS_TUNNEL_HOSTS = new Set(['nas-photos.michaelgarisek.com']);

/** Strip agent mount prefixes so /api/nas/JUN/foo maps to tunnel /JUN/foo, not /_agent/file/receiving/JUN/foo. */
function stripNasAgentMountPrefix(pathname: string): string {
  let clean = (pathname || '').replace(/^\/+/, '');
  for (const prefix of [
    '_agent/file/receiving/',
    '_agent/file/receiving',
    '_agent/file/shipping/',
    '_agent/file/shipping',
  ]) {
    if (clean.startsWith(prefix)) {
      clean = clean.slice(prefix.length);
      break;
    }
  }
  return clean;
}

function encodeNasProxyPath(pathname: string): string {
  const clean = stripNasAgentMountPrefix(pathname);
  if (!clean) return '/api/nas';
  return `/api/nas/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

export function normalizePhotoDisplayUrl(
  url: string,
  opts?: { production?: boolean },
): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return trimmed;

  const isProd = opts?.production ?? process.env.NODE_ENV === 'production';

  if (isProd && trimmed.startsWith('/api/nas-dev/')) {
    return trimmed.replace(/^\/api\/nas-dev\//, '/api/nas/');
  }

  if (trimmed.startsWith('/api/nas')) {
    const sub = trimmed.replace(/^\/api\/nas\/?/, '');
    if (!sub) return '/api/nas';
    const stripped = stripNasAgentMountPrefix(sub);
    if (stripped === sub) return trimmed;
    return encodeNasProxyPath(`/${stripped}`);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      if (NAS_TUNNEL_HOSTS.has(host) || host.endsWith('.trycloudflare.com')) {
        return encodeNasProxyPath(parsed.pathname);
      }
    } catch {
      /* keep original */
    }
  }

  return trimmed;
}

export function isSameOriginNasProxyUrl(url: string): boolean {
  return url.startsWith('/api/nas') || url.startsWith('/api/nas-dev');
}
