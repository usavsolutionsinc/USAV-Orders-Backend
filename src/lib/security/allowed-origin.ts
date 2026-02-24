function normalizeHost(value: string | null | undefined): string {
  if (!value) return '';
  let host = String(value).trim().toLowerCase();

  // x-forwarded-host can include comma-separated values.
  if (host.includes(',')) {
    host = host.split(',')[0].trim();
  }

  // Handle values accidentally passed as full URLs.
  if (host.startsWith('http://') || host.startsWith('https://')) {
    try {
      host = new URL(host).host.toLowerCase();
    } catch {
      // Keep the original host fallback.
    }
  }

  // Normalize default ports to avoid false mismatches.
  if (host.endsWith(':443')) return host.slice(0, -4);
  if (host.endsWith(':80')) return host.slice(0, -3);
  return host;
}

function getEnvHosts(): string[] {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL,
  ];

  return candidates
    .map((value) => normalizeHost(value))
    .filter(Boolean);
}

export function isAllowedAdminOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;

  let originHost = '';
  try {
    originHost = normalizeHost(new URL(origin).host);
  } catch {
    return false;
  }

  const requestHost = normalizeHost(
    req.headers.get('x-forwarded-host') || req.headers.get('host')
  );

  if (requestHost && requestHost === originHost) return true;

  const localhostHosts = new Set(['localhost:3000', '127.0.0.1:3000']);
  if (localhostHosts.has(originHost)) return true;

  if (originHost.endsWith('.vercel.app')) return true;

  const envHosts = getEnvHosts();
  return envHosts.includes(originHost);
}

