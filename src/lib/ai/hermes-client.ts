import 'server-only';

const DEFAULT_HERMES_API_URL = 'http://127.0.0.1:8642/v1';

export function getHermesApiUrl(): string {
  return String(process.env.HERMES_API_URL || DEFAULT_HERMES_API_URL).replace(/\/$/, '');
}

export function getHermesModel(defaultModel = 'hermes-agent'): string {
  return String(process.env.HERMES_MODEL || process.env.AI_MODEL || defaultModel).trim();
}

export function getHermesHeaders(extra?: HeadersInit): HeadersInit {
  const apiKey = String(process.env.HERMES_API_KEY || '').trim();
  const cfAccessClientId = String(process.env.CLOUDFLARE_ACCESS_CLIENT_ID || '').trim();
  const cfAccessClientSecret = String(process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET || '').trim();

  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(cfAccessClientId ? { 'CF-Access-Client-Id': cfAccessClientId } : {}),
    ...(cfAccessClientSecret ? { 'CF-Access-Client-Secret': cfAccessClientSecret } : {}),
    ...extra,
  };
}

