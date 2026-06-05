import type { CarrierCode } from './types';

/**
 * Single source of truth for which carriers we actively poll for tracking.
 *
 * USPS is currently DISABLED — we're still waiting on OAuth credentials from
 * USPS, so any USPS Track call would just 401. Keeping it out of this set means
 * the cron sweeps (`getDueShipments`) never select USPS rows and any manual
 * refresh (`syncShipment`) skips USPS gracefully instead of erroring.
 *
 * To re-enable once USPS OAuth is provisioned: add 'USPS' back to the array.
 */
export const ENABLED_SYNC_CARRIERS: readonly CarrierCode[] = ['UPS', 'FEDEX'];

export function isCarrierSyncEnabled(carrier: string | null | undefined): boolean {
  return !!carrier && (ENABLED_SYNC_CARRIERS as readonly string[]).includes(carrier);
}
