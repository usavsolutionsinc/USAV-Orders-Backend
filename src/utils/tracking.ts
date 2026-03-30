/**
 * Re-exports from the canonical tracking-format.ts.
 * Kept for backward-compatibility of existing import paths.
 */
export {
  type Carrier,
  getCarrier,
  detectCarrier,
  formatTrackingNumber,
  hasNumbers,
  getLastEightDigits,
  cleanTrackingNumber,
  getTrackingUrlByCarrier,
  getTrackingUrl,
} from '@/lib/tracking-format';
