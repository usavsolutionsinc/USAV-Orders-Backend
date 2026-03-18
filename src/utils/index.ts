/**
 * Utility functions barrel export.
 *
 * Import everything from '@/utils':
 *   import { cn, formatCurrency, retry, safeAwait } from '@/utils';
 *
 * Category files (internal — import via this barrel only):
 *   _cn.ts        Tailwind class merging
 *   _string.ts    String manipulation
 *   _number.ts    Number formatting
 *   _date.ts      Generic date helpers
 *   _array.ts     Array helpers
 *   _object.ts    Object helpers
 *   _url.ts       URL / query string helpers
 *   _validation.ts Input validation predicates
 *   _async.ts     Async helpers (retry, sleep, safeAwait, debounceAsync)
 *   _dom.ts       DOM / browser helpers
 */

// ─── New consolidated category exports ────────────────────────────────────────
export * from './_cn';
export * from './_string';
export * from './_number';
export * from './_date';
export * from './_array';
export * from './_object';
export * from './_url';
export * from './_validation';
export * from './_async';
export * from './_dom';

// ─── Existing domain-specific exports ─────────────────────────────────────────
export * from './tracking';
export * from './sku';
export * from './barcode';
export * from './events';
export * from './staff-colors';
export * from './date';
export * from './isElectron';
export * from './order-display';
export * from './order-links';
export * from './order-platform';
export * from './orders';
export * from './packer';
export * from './source-dot';
export * from './staff';
