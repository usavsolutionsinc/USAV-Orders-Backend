/**
 * Shared Square API client — centralizes auth, base URL, and error handling.
 * Extracted from src/app/api/repair/square-payment-link/route.ts.
 */

const SQUARE_PRODUCTION_BASE_URL = 'https://connect.squareup.com/v2';
const SQUARE_SANDBOX_BASE_URL = 'https://connect.squareupsandbox.com/v2';

export interface SquareError {
  code?: string;
  detail?: string;
  field?: string;
}

export interface SquareConfig {
  baseUrl: string;
  accessToken: string;
  version: string;
  locationId: string;
  currency: string;
}

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function resolveSquareBaseUrl(): string {
  const explicit = process.env.SQUARE_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const env = (process.env.SQUARE_ENVIRONMENT || '').trim().toUpperCase();
  if (env === 'SANDBOX') return SQUARE_SANDBOX_BASE_URL;
  return SQUARE_PRODUCTION_BASE_URL;
}

export function getSquareConfig(): SquareConfig {
  return {
    baseUrl: resolveSquareBaseUrl(),
    accessToken: requiredEnvAny('SQUARE_ACCESS_TOKEN', [
      'SQUARE_TOKEN',
      'SQUARE_API_TOKEN',
      'NEXT_PUBLIC_SQUARE_ACCESS_TOKEN',
    ]),
    version: process.env.SQUARE_VERSION || '2024-01-18',
    locationId: requiredEnvAny('SQUARE_LOCATION_ID', [
      'SQUARE_DEFAULT_LOCATION_ID',
      'NEXT_PUBLIC_SQUARE_LOCATION_ID',
    ]),
    currency: (process.env.SQUARE_CURRENCY || 'USD').trim().toUpperCase(),
  };
}

export function formatSquareErrors(errors: SquareError[] | undefined): string {
  if (!Array.isArray(errors) || errors.length === 0) return 'Square API request failed';
  return errors
    .map((e) => [e.code, e.detail, e.field].filter(Boolean).join(' | '))
    .filter(Boolean)
    .join('; ');
}

/**
 * Thin wrapper around fetch that adds Square auth headers and handles JSON errors.
 */
export async function squareFetch<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    config?: SquareConfig;
  } = {},
): Promise<{ ok: boolean; status: number; data: T; errors?: SquareError[] }> {
  const cfg = options.config ?? getSquareConfig();
  const url = `${cfg.baseUrl}${path}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Square-Version': cfg.version,
      'Content-Type': 'application/json',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = (await response.json().catch(() => ({}))) as T & { errors?: SquareError[] };

  return {
    ok: response.ok,
    status: response.status,
    data,
    errors: (data as any)?.errors,
  };
}

/**
 * Convert a dollar string (e.g. "12.50") to cents integer.
 */
export function parsePriceToMinorUnits(value: string | null | undefined): number | null {
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const amount = Math.round(parsed * 100);
  return amount > 0 ? amount : null;
}

/**
 * Format cents as a dollar string (e.g. 1250 → "$12.50").
 */
export function formatCentsToDollars(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}
