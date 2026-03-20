export interface RetryOptions {
  retries?: number;
  delayMs?: number;
}

const CONNECTIVITY_ERROR_CODES = new Set([
  'CONNECT_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  '57P01',
  '57P02',
  '57P03',
]);

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '').trim().toUpperCase();
}

export function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = getErrorCode(error);
  if (CONNECTIVITY_ERROR_CODES.has(code)) return true;

  const causeMessage = typeof (error as { cause?: unknown }).cause === 'object'
    ? String(((error as { cause?: { message?: string } }).cause?.message) || '')
    : '';
  const message = `${error.message} ${causeMessage}`;
  return /ENOTFOUND|ECONNREFUSED|connect_timeout|connection terminated|timeout|ECONNRESET|57P01|57P02|57P03/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function queryWithRetry<T>(
  queryFn: () => Promise<T>,
  { retries = 3, delayMs = 1000 }: RetryOptions = {},
): Promise<T> {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await queryFn();
    } catch (error) {
      const canRetry = isTransientDbError(error) && i < retries - 1;
      if (!canRetry) throw error;
      await sleep(delayMs * (i + 1));
    }
  }

  throw new Error('queryWithRetry exhausted retries');
}

