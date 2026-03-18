# 03 — Utils & Formatting Consolidation

---

## Goals

- Merge all scattered utility functions into `src/utils/index.ts`
- Eliminate duplicate formatters (dates, currency, strings, numbers)
- Organise by domain in internal files, expose via single barrel
- Add TypeScript generics and strict types throughout
- Document every function with JSDoc + examples

---

## 1. Audit: Find All Utils

```bash
# Find all util/helper files
find src -name "*.utils.ts" -o -name "helpers.ts" -o -name "format*.ts" | sort

# Find loose utility functions in component files
grep -rn "^export function\|^export const" src --include="*.tsx" \
  | grep -v "default\|component\|Component\|Page\|Layout" | sort
```

---

## 2. Target File Structure

```
src/
  utils/
    index.ts         ← single barrel export
    _string.ts       ← string manipulation
    _number.ts       ← number formatting
    _date.ts         ← date/time formatting
    _array.ts        ← array helpers
    _object.ts       ← object helpers
    _url.ts          ← URL / query string helpers
    _validation.ts   ← input validation predicates
    _async.ts        ← async helpers (retry, sleep, debounce fn)
    _dom.ts          ← DOM/browser helpers
    _cn.ts           ← Tailwind class merging (cn utility)
```

`index.ts` re-exports all:

```ts
export * from './_string';
export * from './_number';
export * from './_date';
export * from './_array';
export * from './_object';
export * from './_url';
export * from './_validation';
export * from './_async';
export * from './_dom';
export * from './_cn';
```

---

## 3. Core Implementations

### `_cn.ts` — Tailwind class merging

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind classes, resolving conflicts correctly.
 * @example cn('p-4', condition && 'p-8') → 'p-8' (if condition true)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```bash
npm install clsx tailwind-merge
```

---

### `_string.ts`

```ts
/**
 * Capitalises the first letter of a string.
 * @example capitalize('hello') → 'Hello'
 */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Converts camelCase or PascalCase to Title Case.
 * @example toTitleCase('myVariableName') → 'My Variable Name'
 */
export function toTitleCase(s: string): string {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

/**
 * Truncates string to maxLength with ellipsis.
 * @example truncate('Hello World', 8) → 'Hello...'
 */
export function truncate(s: string, maxLength: number, suffix = '...'): string {
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Converts a string to a URL-safe slug.
 * @example slugify('Hello World!') → 'hello-world'
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strips HTML tags from a string.
 */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
```

---

### `_number.ts`

```ts
/**
 * Formats a number as currency.
 * @example formatCurrency(1234.5) → '$1,234.50'
 */
export function formatCurrency(
  value: number,
  currency = 'USD',
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

/**
 * Formats a number with commas.
 * @example formatNumber(1234567) → '1,234,567'
 */
export function formatNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Formats a number as a percentage.
 * @example formatPercent(0.756) → '75.6%'
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Clamps value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds to N decimal places.
 */
export function round(value: number, decimals = 2): number {
  return Number(Math.round(Number(`${value}e${decimals}`)) + `e-${decimals}`);
}
```

---

### `_date.ts`

```ts
/**
 * Formats a date as a readable string.
 * @example formatDate(new Date()) → 'March 18, 2026'
 */
export function formatDate(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
  locale = 'en-US',
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}

/**
 * Returns relative time string.
 * @example timeAgo(Date.now() - 60000) → '1 minute ago'
 */
export function timeAgo(date: Date | string | number): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const intervals: [number, string][] = [
    [31536000, 'year'], [2592000, 'month'], [86400, 'day'],
    [3600, 'hour'], [60, 'minute'], [1, 'second'],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count} ${label}${count !== 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

/**
 * Returns ISO date string (YYYY-MM-DD) for a given date.
 */
export function toISODate(date: Date | string | number): string {
  return new Date(date).toISOString().split('T')[0];
}

/**
 * Checks if a date is today.
 */
export function isToday(date: Date | string | number): boolean {
  return toISODate(date) === toISODate(Date.now());
}
```

---

### `_async.ts`

```ts
/**
 * Pauses execution for `ms` milliseconds.
 */
export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Retries an async function up to `attempts` times with exponential backoff.
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
 * Wraps a promise and returns [data, error] tuple — no try/catch needed.
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
 * Debounces an async function, cancelling in-flight calls.
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay = 300,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) =>
    new Promise((resolve, reject) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args).then(resolve).catch(reject), delay);
    }) as Promise<ReturnType<T>>;
}
```

---

### `_array.ts`

```ts
/** Removes duplicate primitives from array */
export const unique = <T>(arr: T[]): T[] => [...new Set(arr)];

/** Groups array items by a key */
export function groupBy<T, K extends string | number>(
  arr: T[],
  key: (item: T) => K,
): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}

/** Sorts array of objects by a key (ascending by default) */
export function sortBy<T>(arr: T[], key: keyof T, dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...arr].sort((a, b) => {
    if (a[key] < b[key]) return dir === 'asc' ? -1 : 1;
    if (a[key] > b[key]) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

/** Chunks array into pages of size `n` */
export function chunk<T>(arr: T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n),
  );
}
```

---

## 4. Migration Steps

1. Run audit grep commands to find all existing utils.
2. Copy each function to its correct `_*.ts` file.
3. Resolve naming conflicts — keep the most general/typed version.
4. Update all import paths to `@/utils`.
5. Delete original util files.
6. Run `tsc --noEmit` and `knip`.

---

## 5. Checklist

- [ ] Util audit complete
- [ ] `src/utils/` directory created
- [ ] All category `_*.ts` files populated
- [ ] `index.ts` barrel created
- [ ] `cn()` utility replaces all ad-hoc class joining
- [ ] `safeAwait` replaces scattered try/catch patterns
- [ ] `retry()` used in all DB write paths
- [ ] All import paths updated to `@/utils`
- [ ] Original util files deleted
- [ ] TypeScript clean — `tsc --noEmit` passes
