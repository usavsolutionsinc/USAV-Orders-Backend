/**
 * Maps raw station scan strings to UI mode + API routing types.
 * Keeps carrier/serial heuristics in scan-resolver; this layer only adds
 * SKU / repair / FNSKU / command precedence.
 */

import { classifyInput, looksLikeFnsku } from './scan-resolver';

export type StationScanType = 'TRACKING' | 'SERIAL' | 'FNSKU' | 'SKU' | 'REPAIR' | 'COMMAND';
export type StationInputMode = 'tracking' | 'fba' | 'repair' | 'serial';

/**
 * Resolves a raw scan to the controller action type (tracking vs serial vs FBA, …).
 */
export function detectStationScanType(val: string): StationScanType {
  const input = val.trim();
  if (!input) return 'SERIAL';

  if (input.includes(':')) return 'SKU';

  if (/^RS-\d+$/i.test(input)) return 'REPAIR';

  if (looksLikeFnsku(input)) return 'FNSKU';

  if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';

  const { type } = classifyInput(input);
  if (type === 'tracking') return 'TRACKING';

  return 'SERIAL';
}

export function getStationInputMode(val: string): StationInputMode {
  const input = String(val || '').trim();
  if (/^RS-/i.test(input)) return 'repair';

  const type = detectStationScanType(input);
  if (type === 'FNSKU') return 'fba';
  if (type === 'REPAIR') return 'repair';
  if (type === 'TRACKING' || type === 'COMMAND') return 'tracking';
  return 'serial';
}
