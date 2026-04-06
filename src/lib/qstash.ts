import { Client } from '@upstash/qstash';

type QStashDuration = number | `${bigint}s` | `${bigint}m` | `${bigint}h` | `${bigint}d`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getAppBaseUrl(): string {
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  const normalized = String(explicit || '').trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error('APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL is required for QStash');
  }
  return normalized;
}

/**
 * Lightweight origin check for QStash route handlers.
 * Accepts any request that carries the `upstash-signature` header (always
 * present on genuine QStash deliveries) or a `Bearer <QSTASH_TOKEN>` auth
 * header for manual/test invocations.
 */
export function isQStashOrigin(headers: Headers): boolean {
  if (headers.get('upstash-signature')) return true;

  const authHeader = headers.get('authorization');
  const token = process.env.QSTASH_TOKEN;
  if (token && authHeader === `Bearer ${token}`) return true;

  return false;
}

export function getQStashClient(): Client {
  return new Client({
    token: requireEnv('QSTASH_TOKEN'),
    baseUrl: process.env.QSTASH_URL || undefined,
  });
}

export async function enqueueQStashJson<TBody = unknown>(params: {
  path: string;
  body?: TBody;
  delay?: QStashDuration;
  retries?: number;
  timeout?: QStashDuration;
  deduplicationId?: string;
  label?: string;
}) {
  const client = getQStashClient();
  const url = `${getAppBaseUrl()}${params.path.startsWith('/') ? params.path : `/${params.path}`}`;

  return client.publishJSON({
    url,
    body: params.body,
    retries: params.retries,
    timeout: params.timeout,
    delay: params.delay,
    deduplicationId: params.deduplicationId,
    label: params.label,
  });
}

export async function upsertQStashSchedule<TBody = unknown>(params: {
  scheduleId: string;
  path: string;
  cron: string;
  body?: TBody;
  retries?: number;
  timeout?: QStashDuration;
  label?: string;
  /** Headers forwarded to destination when the destination requires custom headers. */
  headers?: Record<string, string>;
}) {
  const client = getQStashClient();
  const destination = `${getAppBaseUrl()}${params.path.startsWith('/') ? params.path : `/${params.path}`}`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...params.headers,
  };

  return client.schedules.create({
    scheduleId: params.scheduleId,
    destination,
    cron: params.cron,
    method: 'POST',
    headers,
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    retries: params.retries,
    timeout: params.timeout,
    label: params.label,
  });
}

export function getQStashResultIdentifier(result: unknown): string | null {
  if (result && typeof result === 'object') {
    if ('messageId' in result && typeof (result as { messageId?: unknown }).messageId === 'string') {
      return (result as { messageId: string }).messageId;
    }
    if ('scheduleId' in result && typeof (result as { scheduleId?: unknown }).scheduleId === 'string') {
      return (result as { scheduleId: string }).scheduleId;
    }
  }
  return null;
}
