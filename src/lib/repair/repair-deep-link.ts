/**
 * Mobile-friendly URL that opens Walk-In repairs and lifts RepairDetailsPanel for this repair.
 */
export function buildRepairDetailsDeepLink(repairId: number, origin: string): string {
  const base = origin.replace(/\/$/, '');
  const url = new URL('/walk-in', base);
  url.searchParams.set('mode', 'repairs');
  url.searchParams.set('openRepair', String(repairId));
  return url.toString();
}
