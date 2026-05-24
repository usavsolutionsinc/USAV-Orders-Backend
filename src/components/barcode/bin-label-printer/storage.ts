import { DEFAULT_GLN } from '@/lib/barcode-routing';
import { CONFIG_KEY, DEFAULT_CONFIG, type PrinterConfig } from './types';

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
      maxPositions: clampMax(parsed?.maxPositions, DEFAULT_CONFIG.maxPositions),
      gln:
        typeof parsed?.gln === 'string' && parsed.gln.trim() ? parsed.gln.trim() : DEFAULT_GLN,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: PrinterConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
