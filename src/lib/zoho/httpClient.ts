import { buildZohoUrl, getAccessToken, invalidateAccessToken } from '@/lib/zoho/core';

const RATE_LIMIT_CONFIG = {
  reservoir: 80,
  reservoirRefillAmount: 80,
  reservoirRefillIntervalMs: 60_000,
  maxConcurrent: 8,
  minTimeMs: 750,
  maxRetries: 4,
  circuitFailureThreshold: 5,
  circuitFailureWindowMs: 30_000,
  circuitOpenMs: 60_000,
  requestTimeoutMs: 10_000,
} as const;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type QueryValue = string | number | boolean | null | undefined;
type ZohoQuery = Record<string, QueryValue>;
type RequestTask<T = unknown> = {
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const when = Date.parse(retryAfter);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

async function readErrorPayload(response: Response): Promise<{ code?: number; message?: string; bodyText?: string }> {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      code: typeof parsed.code === 'number' ? parsed.code : undefined,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      bodyText: text,
    };
  } catch {
    return { bodyText: text };
  }
}

export class ZohoApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly zohoCode: number | null,
    message: string,
    public readonly endpoint: string
  ) {
    super(message);
    this.name = 'ZohoApiError';
  }

  isRetryable(): boolean {
    return [429, 500, 502, 503, 504].includes(this.httpStatus) ||
      (this.zohoCode != null && this.zohoCode >= 5000);
  }

  isValidation(): boolean {
    return this.zohoCode != null && [1002, 1004, 1062].includes(this.zohoCode);
  }
}

export class ZohoRateLimitError extends ZohoApiError {
  constructor(httpStatus: number, zohoCode: number | null, message: string, endpoint: string) {
    super(httpStatus, zohoCode, message, endpoint);
    this.name = 'ZohoRateLimitError';
  }
}

export class ZohoCircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Zoho circuit open for another ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'ZohoCircuitOpenError';
  }
}

class ZohoRateLimiter {
  private queue: Array<RequestTask<any>> = [];
  private activeCount = 0;
  private reservoir = RATE_LIMIT_CONFIG.reservoir;
  private nextAllowedAt = 0;
  private lastRefillAt = Date.now();
  private timer: NodeJS.Timeout | null = null;

  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve, reject });
      this.drain();
    });
  }

  getStatus() {
    this.refill();
    return {
      queueSize: this.queue.length,
      activeCount: this.activeCount,
      reservoir: this.reservoir,
      nextAllowedAt: this.nextAllowedAt,
    };
  }

  private refill() {
    const now = Date.now();
    if (now - this.lastRefillAt >= RATE_LIMIT_CONFIG.reservoirRefillIntervalMs) {
      this.reservoir = RATE_LIMIT_CONFIG.reservoirRefillAmount;
      this.lastRefillAt = now;
    }
  }

  private scheduleDrain(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, Math.max(1, delayMs));
  }

  private drain() {
    this.refill();
    const now = Date.now();

    if (this.activeCount >= RATE_LIMIT_CONFIG.maxConcurrent || this.queue.length === 0) {
      return;
    }

    if (this.reservoir <= 0) {
      this.scheduleDrain(Math.max(1, this.lastRefillAt + RATE_LIMIT_CONFIG.reservoirRefillIntervalMs - now));
      return;
    }

    if (now < this.nextAllowedAt) {
      this.scheduleDrain(this.nextAllowedAt - now);
      return;
    }

    const task = this.queue.shift() as RequestTask<unknown>;
    this.activeCount += 1;
    this.reservoir -= 1;
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + RATE_LIMIT_CONFIG.minTimeMs;

    void task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        this.activeCount -= 1;
        this.drain();
      });

    if (this.queue.length > 0) this.drain();
  }
}

class ZohoCircuitBreaker {
  private consecutiveFailures = 0;
  private firstFailureAt = 0;
  private openUntil = 0;

  assertClosed() {
    const retryAfterMs = this.getRetryAfterMs();
    if (retryAfterMs > 0) throw new ZohoCircuitOpenError(retryAfterMs);
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.firstFailureAt = 0;
  }

  recordFailure() {
    const now = Date.now();
    if (!this.firstFailureAt || now - this.firstFailureAt > RATE_LIMIT_CONFIG.circuitFailureWindowMs) {
      this.firstFailureAt = now;
      this.consecutiveFailures = 1;
    } else {
      this.consecutiveFailures += 1;
    }

    if (this.consecutiveFailures >= RATE_LIMIT_CONFIG.circuitFailureThreshold) {
      this.openUntil = now + RATE_LIMIT_CONFIG.circuitOpenMs;
    }
  }

  getRetryAfterMs() {
    return Math.max(0, this.openUntil - Date.now());
  }

  getStatus() {
    return {
      isOpen: this.getRetryAfterMs() > 0,
      retryAfterMs: this.getRetryAfterMs(),
      consecutiveFailures: this.consecutiveFailures,
      firstFailureAt: this.firstFailureAt || null,
      openUntil: this.openUntil || null,
    };
  }
}

const limiter = new ZohoRateLimiter();
const circuitBreaker = new ZohoCircuitBreaker();

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RATE_LIMIT_CONFIG.requestTimeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function performZohoRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  query: ZohoQuery = {}
): Promise<T> {
  const retryableHttpStatuses = new Set([429, 500, 502, 503, 504]);

  for (let attempt = 0; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    const token = await getAccessToken();
    const url = buildZohoUrl(path, query);

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method,
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error: unknown) {
      if (attempt === RATE_LIMIT_CONFIG.maxRetries) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (response.status === 401 && attempt === 0) {
      await invalidateAccessToken();
      continue;
    }

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      const zohoCode = typeof payload.code === 'number' ? payload.code : null;
      const message =
        payload.message ||
        payload.bodyText ||
        `Zoho API error ${response.status}`;

      const error = response.status === 429
        ? new ZohoRateLimitError(response.status, zohoCode, message, path)
        : new ZohoApiError(response.status, zohoCode, message, path);

      if ((retryableHttpStatuses.has(response.status) || error.isRetryable()) && attempt < RATE_LIMIT_CONFIG.maxRetries) {
        const delayMs = response.status === 429
          ? parseRetryAfter(response.headers.get('Retry-After')) ?? (1000 * 2 ** attempt)
          : 1000 * 2 ** attempt;
        await sleep(delayMs);
        continue;
      }

      throw error;
    }

    const json = await response.json() as Record<string, unknown>;
    if (typeof json.code === 'number' && json.code !== 0) {
      const error = json.code === 44 || json.code === 45 || json.code === 1070
        ? new ZohoRateLimitError(response.status || 429, json.code, String(json.message || 'Zoho rate limit'), path)
        : new ZohoApiError(response.status, json.code, String(json.message || 'Zoho API error'), path);

      if (error.isRetryable() && attempt < RATE_LIMIT_CONFIG.maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw error;
    }

    return json as T;
  }

  throw new ZohoApiError(500, null, 'Zoho request exhausted retries', path);
}

async function scheduleRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  query: ZohoQuery = {}
): Promise<T> {
  circuitBreaker.assertClosed();
  try {
    const result = await limiter.schedule(() => performZohoRequest<T>(method, path, body, query));
    circuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    circuitBreaker.recordFailure();
    throw error;
  }
}

export async function zohoGet<T>(path: string, query: ZohoQuery = {}): Promise<T> {
  return scheduleRequest<T>('GET', path, undefined, query);
}

export async function zohoPost<T>(path: string, body: unknown, query: ZohoQuery = {}): Promise<T> {
  return scheduleRequest<T>('POST', path, body, query);
}

export async function zohoPut<T>(path: string, body: unknown, query: ZohoQuery = {}): Promise<T> {
  return scheduleRequest<T>('PUT', path, body, query);
}

export async function zohoDelete<T>(path: string, query: ZohoQuery = {}): Promise<T> {
  return scheduleRequest<T>('DELETE', path, undefined, query);
}

export async function* paginateZohoList<T>(
  path: string,
  resourceKey: string,
  params: ZohoQuery = {}
): AsyncGenerator<T[]> {
  let page = 1;
  while (true) {
    const response = await zohoGet<Record<string, unknown> & {
      page_context?: { has_more_page?: boolean };
    }>(path, {
      ...params,
      page,
      per_page: 200,
    });

    const pageRows = Array.isArray(response[resourceKey]) ? (response[resourceKey] as T[]) : [];
    yield pageRows;

    if (!response.page_context?.has_more_page) break;
    page += 1;
  }
}

export function getZohoHttpClientStatus() {
  return {
    config: RATE_LIMIT_CONFIG,
    limiter: limiter.getStatus(),
    circuit: circuitBreaker.getStatus(),
  };
}
