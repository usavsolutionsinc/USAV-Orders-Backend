import { DEFAULT_GLN } from '@/lib/barcode-routing';

/**
 * Pure config + storage layer for the rack label printer. No React — the
 * per-warehouse counts/GLN are persisted to localStorage so they survive
 * without a rebuild.
 */

export interface PrinterConfig {
  maxAisles: number;
  maxBays: number;
  maxLevels: number;
  gln: string;
}

export const DEFAULT_CONFIG: PrinterConfig = {
  maxAisles: 6,
  maxBays: 12,
  maxLevels: 5,
  gln: DEFAULT_GLN,
};

const CONFIG_KEY = 'rackPrinter.config.v1';

export type Step = 'zone' | 'aisle' | 'bay' | 'level';

export const STEPS: { id: Step; label: string }[] = [
  { id: 'zone',  label: 'Zone' },
  { id: 'aisle', label: 'Aisle' },
  { id: 'bay',   label: 'Bay' },
  { id: 'level', label: 'Level' },
];

/** Clamp a count to a sane integer in [1, 99], falling back when invalid. */
export function clampMax(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(99, Math.max(1, Math.floor(n)));
}

export function loadConfig(): PrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      maxAisles: clampMax(parsed?.maxAisles, DEFAULT_CONFIG.maxAisles),
      maxBays: clampMax(parsed?.maxBays, DEFAULT_CONFIG.maxBays),
      maxLevels: clampMax(parsed?.maxLevels, DEFAULT_CONFIG.maxLevels),
      gln: typeof parsed?.gln === 'string' && parsed.gln.trim() ? parsed.gln.trim() : DEFAULT_GLN,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: PrinterConfig): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
