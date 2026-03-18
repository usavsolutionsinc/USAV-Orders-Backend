/**
 * Pauses execution for `ms` milliseconds.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

/**
 * Retries an async function up to `attempts` times with exponential backoff.
 * @example const data = await retry(() => fetchUser(id), 3, 300);
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelay = 300,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseDelay * 2 ** i);
    }
  }
  throw lastErr;
}

/**
 * Wraps a promise and returns [data, error] tuple — eliminates scattered try/catch.
 * @example const [user, err] = await safeAwait(fetchUser(id));
 */
export async function safeAwait<T>(
  promise: Promise<T>,
): Promise<[T, null] | [null, Error]> {
  try {
    return [await promise, null];
  } catch (err) {
    return [null, err instanceof Error ? err : new Error(String(err))];
  }
}

/**
 * Debounces an async function, cancelling in-flight calls when a new one arrives.
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay = 300,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) =>
    new Promise((resolve, reject) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args).then(resolve as (v: unknown) => void).catch(reject), delay);
    }) as Promise<ReturnType<T>>;
}

/**
 * Runs an array of async tasks with a concurrency limit.
 * @example await withConcurrency(ids, id => fetchUser(id), 5)
 */
export async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Wraps a function with a timeout. Throws if it doesn't resolve within `ms`.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}
