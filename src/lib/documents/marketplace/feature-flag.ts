/** Feature flag for marketplace document fetch (Phase C). */

export function isOutboundMarketplaceFetchEnabled(): boolean {
  const raw = process.env.OUTBOUND_MARKETPLACE_FETCH?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  // Enabled by default — set OUTBOUND_MARKETPLACE_FETCH=false to restore stub behavior.
  return true;
}
