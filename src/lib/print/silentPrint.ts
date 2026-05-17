/**
 * Renderer-side helper for printing HTML silently when running inside the
 * Electron desktop shell. Outside Electron, helpers fall back to the popup +
 * window.print() path which always shows the OS dialog.
 *
 * The saved preset (printer, paper size, copies) is the single source of
 * truth for silent prints. Callers may still pass per-print overrides via
 * `options`, but when a preset value is set it wins.
 */

const PRESET_KEY = 'usav.printPreset';
const LEGACY_PRINTER_KEY = 'usav.silentPrinter';

export type PageSize =
  | 'A4'
  | 'A3'
  | 'Letter'
  | 'Legal'
  | 'Tabloid'
  | { width: number; height: number };

export interface PaperSizeOption {
  /** Stable id stored in the preset. */
  id: string;
  /** Human-readable label shown in the preferences UI. */
  label: string;
  /** What gets passed to Electron's webContents.print(). */
  pageSize: PageSize;
}

/**
 * Built-in paper sizes. Dimensions are in microns (1in = 25 400 μm).
 * Add more entries here as new label stock gets used.
 */
export const PAPER_SIZE_OPTIONS: readonly PaperSizeOption[] = [
  { id: 'thermal-2x1', label: '2" × 1" thermal label', pageSize: { width: 50800, height: 25400 } },
  { id: 'thermal-3x1', label: '3" × 1" file folder', pageSize: { width: 76200, height: 25400 } },
  { id: 'thermal-3x2', label: '3" × 2"', pageSize: { width: 76200, height: 50800 } },
  { id: 'thermal-4x4', label: '4" × 4" shipping', pageSize: { width: 101600, height: 101600 } },
  { id: 'thermal-4x6', label: '4" × 6" shipping label', pageSize: { width: 101600, height: 152400 } },
  { id: 'dymo-2.25x1.25', label: '2.25" × 1.25" Dymo', pageSize: { width: 57150, height: 31750 } },
  { id: 'letter', label: 'Letter (8.5" × 11")', pageSize: 'Letter' },
  { id: 'a4', label: 'A4 (210 × 297 mm)', pageSize: 'A4' },
];

export const AUTO_PAPER_ID = 'auto';

export interface PrintPreset {
  version: 1;
  /** OS printer name, or null = system default. */
  deviceName: string | null;
  /** A paper-size id from PAPER_SIZE_OPTIONS, or 'auto' to let each label decide. */
  paperSizeId: string;
  /** Number of copies per print. */
  copies: number;
}

const DEFAULT_PRESET: PrintPreset = {
  version: 1,
  deviceName: null,
  paperSizeId: AUTO_PAPER_ID,
  copies: 1,
};

export interface SilentPrintOptions {
  deviceName?: string;
  copies?: number;
  waitMs?: number;
  margins?: {
    marginType?: 'default' | 'none' | 'printableArea' | 'custom';
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  pageSize?: PageSize;
  landscape?: boolean;
  color?: boolean;
  printBackground?: boolean;
  scaleFactor?: number;
  dpi?: { horizontal: number; vertical: number };
}

export interface PrinterInfo {
  name: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
  status?: number;
}

interface ElectronPrintAPI {
  isElectron?: boolean;
  printHtml?: (
    html: string,
    options?: SilentPrintOptions,
  ) => Promise<{ success: boolean; reason: string | null }>;
  listPrinters?: () => Promise<PrinterInfo[]>;
}

function getApi(): ElectronPrintAPI | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: ElectronPrintAPI }).electronAPI;
  return api && typeof api === 'object' ? api : null;
}

export function isElectron(): boolean {
  const api = getApi();
  return !!api?.isElectron && typeof api?.printHtml === 'function';
}

function readPreset(): PrintPreset {
  if (typeof window === 'undefined') return DEFAULT_PRESET;
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PrintPreset>;
      return {
        version: 1,
        deviceName: parsed.deviceName ?? null,
        paperSizeId: parsed.paperSizeId ?? AUTO_PAPER_ID,
        copies: Number.isFinite(parsed.copies) && parsed.copies! > 0 ? parsed.copies! : 1,
      };
    }
    // Migrate the v1 single-string printer key into a full preset
    const legacy = window.localStorage.getItem(LEGACY_PRINTER_KEY);
    if (legacy && legacy.trim()) {
      const migrated: PrintPreset = { ...DEFAULT_PRESET, deviceName: legacy.trim() };
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem(LEGACY_PRINTER_KEY);
      return migrated;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_PRESET;
}

export function getSavedPreset(): PrintPreset {
  return readPreset();
}

export function setSavedPreset(preset: Partial<PrintPreset>): PrintPreset {
  const merged: PrintPreset = { ...readPreset(), ...preset, version: 1 };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
  }
  return merged;
}

export function clearSavedPreset(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PRESET_KEY);
    window.localStorage.removeItem(LEGACY_PRINTER_KEY);
  } catch {
    /* ignore */
  }
}

export function resolvePaperSizeOption(id: string): PaperSizeOption | null {
  return PAPER_SIZE_OPTIONS.find((p) => p.id === id) ?? null;
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  const api = getApi();
  if (!api?.listPrinters) return [];
  try {
    return (await api.listPrinters()) ?? [];
  } catch {
    return [];
  }
}

/**
 * Print fully-formed HTML silently. Saved preset wins over caller's options
 * for `deviceName`, `copies`, and `pageSize`. Returns true if Electron handled
 * it, false if the caller should fall back to a browser popup + window.print().
 */
export async function printHtmlSilent(
  html: string,
  options: SilentPrintOptions = {},
): Promise<boolean> {
  const api = getApi();
  if (!api?.printHtml) return false;

  const preset = readPreset();
  const presetPaper = preset.paperSizeId === AUTO_PAPER_ID
    ? null
    : resolvePaperSizeOption(preset.paperSizeId);

  const merged: SilentPrintOptions = {
    ...options,
    deviceName: preset.deviceName ?? options.deviceName,
    copies: preset.copies ?? options.copies,
    pageSize: presetPaper?.pageSize ?? options.pageSize,
  };

  try {
    const result = await api.printHtml(html, merged);
    if (!result?.success) {
      console.warn('[silentPrint] failed:', result?.reason);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[silentPrint] error:', err);
    return false;
  }
}

