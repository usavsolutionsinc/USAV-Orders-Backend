export type StationTheme = 'green' | 'purple' | 'blue' | 'yellow' | 'black' | 'red' | 'lightblue' | 'pink';
export type TechStationTheme = 'green' | 'purple' | 'blue' | 'yellow';
export type PackerStationTheme = 'black' | 'red';

/** Visible theme border on the tech {@link StationScanBar} `<input>` only (no outer wrapper). */
export const techStationScanInputBorderClass: Record<TechStationTheme, string> = {
  green: 'border-2 border-emerald-500',
  blue: 'border-2 border-blue-500',
  purple: 'border-2 border-purple-500',
  yellow: 'border-2 border-amber-500',
};

/**
 * Soft 1px outline in the same hue as {@link techStationScanInputBorderClass} (e.g. up-next TabSwitch rail + pill).
 */
export const techStationLightChromeOutlineClass: Record<TechStationTheme, string> = {
  green: 'border border-emerald-200',
  blue: 'border border-blue-200',
  purple: 'border border-purple-200',
  yellow: 'border border-amber-200',
};

export function getTechStationLightChromeOutlineClass(
  techId: number | string | null | undefined,
): string {
  return techStationLightChromeOutlineClass[getTechThemeById(techId)];
}

/** Same stroke weights as {@link techStationScanInputBorderClass}, for all {@link StationTheme} (FBA sidebar, staff 7/8, etc.). */
export const stationScanInputBorderClass: Record<StationTheme, string> = {
  green: 'border-2 border-emerald-500',
  blue: 'border-2 border-blue-500',
  purple: 'border-2 border-purple-500',
  yellow: 'border-2 border-amber-500',
  black: 'border-2 border-slate-700', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
  red: 'border-2 border-red-500',
  lightblue: 'border-2 border-sky-500',
  pink: 'border-2 border-pink-500',
};

export interface StationThemeColors {
  bg: string;
  hover: string;
  light: string;
  border: string;
  text: string;
  shadow: string;
}

export interface StationInputThemeClasses {
  text: string;
  bg: string;
  ring: string;
  border: string;
}

export const stationThemeColors: Record<StationTheme, StationThemeColors> = {
  green: {
    bg: 'bg-emerald-600',
    hover: 'hover:bg-emerald-700',
    light: 'bg-emerald-50',
    border: 'border-emerald-100',
    text: 'text-emerald-600',
    shadow: 'shadow-emerald-100',
  },
  blue: {
    bg: 'bg-blue-600',
    hover: 'hover:bg-blue-700',
    light: 'bg-blue-50',
    border: 'border-blue-100',
    text: 'text-blue-600',
    shadow: 'shadow-blue-100',
  },
  purple: {
    bg: 'bg-purple-600',
    hover: 'hover:bg-purple-700',
    light: 'bg-purple-50',
    border: 'border-purple-100',
    text: 'text-purple-600',
    shadow: 'shadow-purple-100',
  },
  yellow: {
    bg: 'bg-amber-500',
    hover: 'hover:bg-amber-600',
    light: 'bg-amber-50',
    border: 'border-amber-100',
    text: 'text-amber-600',
    shadow: 'shadow-amber-100',
  },
  black: {
    bg: 'bg-slate-900', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    hover: 'hover:bg-slate-800', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    light: 'bg-surface-canvas',
    border: 'border-border-soft',
    text: 'text-text-default',
    shadow: 'shadow-slate-200',
  },
  red: {
    bg: 'bg-red-600',
    hover: 'hover:bg-red-700',
    light: 'bg-red-50',
    border: 'border-red-100',
    text: 'text-red-600',
    shadow: 'shadow-red-100',
  },
  lightblue: {
    bg: 'bg-sky-400',
    hover: 'hover:bg-sky-500',
    light: 'bg-sky-50',
    border: 'border-sky-100',
    text: 'text-sky-500',
    shadow: 'shadow-sky-100',
  },
  pink: {
    bg: 'bg-pink-500',
    hover: 'hover:bg-pink-600',
    light: 'bg-pink-50',
    border: 'border-pink-100',
    text: 'text-pink-500',
    shadow: 'shadow-pink-100',
  },
};

export function getStationGoalBarThemeClasses(theme: StationTheme): {
  textClass: string;
  fillClass: string;
} {
  const colors = stationThemeColors[theme];
  return {
    textClass: colors.text,
    fillClass: colors.bg,
  };
}

export const stationThemeClasses: Record<
  StationTheme,
  {
    active: string;
    inactive: string;
  }
> = {
  green: {
    active: 'bg-emerald-600 text-white border-emerald-600',
    inactive: 'bg-surface-card text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
  blue: {
    active: 'bg-blue-600 text-white border-blue-600',
    inactive: 'bg-surface-card text-blue-700 border-blue-200 hover:bg-blue-50',
  },
  purple: {
    active: 'bg-purple-600 text-white border-purple-600',
    inactive: 'bg-surface-card text-purple-700 border-purple-200 hover:bg-purple-50',
  },
  yellow: {
    active: 'bg-amber-500 text-white border-amber-500',
    inactive: 'bg-surface-card text-amber-700 border-amber-200 hover:bg-amber-50',
  },
  black: {
    active: 'bg-slate-900 text-white border-slate-900', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    inactive: 'bg-surface-sunken text-text-default border-border-default hover:bg-surface-strong',
  },
  red: {
    active: 'bg-red-600 text-white border-red-600',
    inactive: 'bg-surface-card text-red-700 border-red-200 hover:bg-red-50',
  },
  lightblue: {
    active: 'bg-sky-400 text-white border-sky-400',
    inactive: 'bg-surface-card text-sky-600 border-sky-200 hover:bg-sky-50',
  },
  pink: {
    active: 'bg-pink-500 text-white border-pink-500',
    inactive: 'bg-surface-card text-pink-600 border-pink-200 hover:bg-pink-50',
  },
};

export const packerInputThemeClasses: Record<PackerStationTheme, StationInputThemeClasses> = {
  black: {
    text: 'text-text-default',
    bg: 'bg-slate-900', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    ring: 'focus:ring-slate-500/10', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    border: 'focus:border-slate-500', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
  },
  red: {
    text: 'text-red-600',
    bg: 'bg-red-600',
    ring: 'focus:ring-red-500/10',
    border: 'focus:border-red-500',
  },
};

/**
 * Anchor hexes for each StationTheme. Used to map an arbitrary DB color_hex
 * onto the nearest themed Tailwind class chain (FBA chrome, packer/tech
 * inputs, print queue, etc.). Tuned to match the actual class palettes in
 * {@link stationThemeColors} so the chrome stays visually coherent.
 */
const THEME_ANCHOR_HEX: Record<StationTheme, [number, number, number]> = {
  green:     [16, 185, 129],   // emerald-500
  blue:      [59, 130, 246],   // blue-500
  purple:    [168, 85, 247],   // purple-500
  yellow:    [245, 158, 11],   // amber-500
  black:     [30, 41, 59],     // slate-800
  red:       [239, 68, 68],    // red-500
  lightblue: [14, 165, 233],   // sky-500
  pink:      [236, 72, 153],   // pink-500
};

/**
 * Module-level cache of staff color_hex values keyed by staff ID. Populated
 * once on app boot by <StaffColorsProvider> (root layout). Drives the
 * synchronous resolvers ({@link getStaffThemeById}, {@link getStaffColorHex})
 * that 30+ components depend on without forcing every consumer to thread the
 * staff record through props.
 *
 * Reactivity: when the cache is replaced (e.g. an admin changes a staff
 * color), subscribers are notified. Components that need to re-render on
 * color change should call {@link useStaffColorVersion}.
 */
const _staffColorCache = new Map<number, string>();
let _staffColorVersion = 0;
const _staffColorSubscribers = new Set<() => void>();

/**
 * Persists the cache between page loads so themed chrome (packer scan-bar
 * border, FBA sidebar gradients, etc.) paints with the right hue immediately
 * on cold boot instead of flashing the emerald default until
 * <StaffColorsProvider>'s /api/staff fetch resolves.
 */
const STORAGE_KEY = 'usav_staff_colors_v1';

function persistStaffColorCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const out: Array<[number, string]> = [];
    for (const [id, hex] of _staffColorCache) out.push([id, hex]);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // quota / privacy mode — silently drop
  }
}

function hydrateStaffColorCacheFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, hex] = entry;
      if (typeof id !== 'number' || typeof hex !== 'string') continue;
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
      _staffColorCache.set(id, hex.toLowerCase());
    }
    if (_staffColorCache.size > 0) _staffColorVersion += 1;
  } catch {
    // corrupt JSON — ignore; next setStaffColorCache will overwrite
  }
}

// Runs once on first client import, before any React render. Safe on the
// server because the typeof window guard short-circuits.
hydrateStaffColorCacheFromStorage();

export function setStaffColorCache(entries: Array<{ id: number; color_hex?: string | null }>): void {
  _staffColorCache.clear();
  for (const e of entries) {
    if (e.color_hex && /^#[0-9a-fA-F]{6}$/.test(e.color_hex)) {
      _staffColorCache.set(e.id, e.color_hex.toLowerCase());
    }
  }
  _staffColorVersion += 1;
  persistStaffColorCache();
  _staffColorSubscribers.forEach((fn) => fn());
}

export function _subscribeStaffColorCache(fn: () => void): () => void {
  _staffColorSubscribers.add(fn);
  return () => { _staffColorSubscribers.delete(fn); };
}

export function _getStaffColorVersion(): number {
  return _staffColorVersion;
}

function parseStaffId(staffId: number | string | null | undefined): number | null {
  const parsed = Number(staffId);
  return Number.isFinite(parsed) ? parsed : null;
}

function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Nearest of the 8 station themes for an arbitrary hex (squared RGB distance). */
export function themeFromHex(hex: string | null | undefined): StationTheme {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'green';
  let best: StationTheme = 'green';
  let bestDist = Infinity;
  for (const [name, anchor] of Object.entries(THEME_ANCHOR_HEX) as Array<[StationTheme, [number, number, number]]>) {
    const dr = rgb[0] - anchor[0];
    const dg = rgb[1] - anchor[1];
    const db = rgb[2] - anchor[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
}

/** Default fallback hex when no DB color is available (cache miss or pre-load). */
const DEFAULT_COLOR_HEX = '#10b981';

/**
 * Sync theme resolver keyed by staff ID. Reads from the module-level color
 * cache populated by <StaffColorsProvider>. Returns the emerald default when
 * the cache hasn't been populated yet, when the ID is missing, or when the
 * staff hasn't had a color assigned. There is no longer a hardcoded id→theme
 * fallback — the DB column staff.color_hex is the only source of truth.
 */
export function getStaffThemeById(
  staffId: number | string | null | undefined,
): StationTheme {
  const id = parseStaffId(staffId);
  if (!id) return 'green';
  const hex = _staffColorCache.get(id);
  if (!hex) return 'green';
  return themeFromHex(hex);
}

/**
 * Preferred resolver when the caller has the staff record (with color_hex)
 * already loaded — skips the module cache. Falls back to the cache lookup if
 * color_hex isn't on the record.
 */
export function getStaffTheme(
  staff: { id?: number | string | null; color_hex?: string | null } | null | undefined,
): StationTheme {
  if (!staff) return 'green';
  if (staff.color_hex) return themeFromHex(staff.color_hex);
  return getStaffThemeById(staff.id);
}

/**
 * Resolved hex for a staff record. Prefers the record's own color_hex, then
 * the module cache (populated by StaffColorsProvider), then a neutral default
 * so unset / pre-load staff don't render transparent.
 */
export function getStaffColorHex(
  staff: { id?: number | string | null; color_hex?: string | null } | null | undefined,
): string {
  if (staff?.color_hex && /^#[0-9a-fA-F]{6}$/.test(staff.color_hex)) {
    return staff.color_hex.toLowerCase();
  }
  const id = parseStaffId(staff?.id);
  if (id) {
    const cached = _staffColorCache.get(id);
    if (cached) return cached;
  }
  return DEFAULT_COLOR_HEX;
}

function getTechThemeById(techId: number | string | null | undefined): TechStationTheme {
  const theme = getStaffThemeById(techId);
  return (theme === 'green' || theme === 'blue' || theme === 'purple' || theme === 'yellow') ? theme : 'green';
}

function getPackerThemeById(packerId: number | string | null | undefined): PackerStationTheme {
  const theme = getStaffThemeById(packerId);
  return (theme === 'black' || theme === 'red') ? theme : 'black';
}

export function getPackerInputTheme(
  packerIdOrTheme: number | string | PackerStationTheme | null | undefined
): StationInputThemeClasses {
  const theme =
    packerIdOrTheme === 'black' || packerIdOrTheme === 'red'
      ? packerIdOrTheme
      : getPackerThemeById(packerIdOrTheme);
  return packerInputThemeClasses[theme];
}

/** FBA print queue: checkbox + selected row — Tailwind literals for purge. */
export const printQueueTableUi: Record<
  StationTheme,
  {
    checkboxChecked: string;
    checkboxIdleHover: string;
    checkboxFocusRing: string;
    rowSelected: string;
    rowFocusRing: string;
    /** “Ready” row status (no checkmark icon) — matches station hue */
    readyStatusPill: string;
    toolbarAccent: string;
    toolbarIconMuted: string;
    metaIconAccent: string;
    refreshHover: string;
    statusFocusRing: string;
  }
> = {
  green: {
    checkboxChecked: 'border-emerald-600 bg-emerald-600',
    checkboxIdleHover: 'hover:border-emerald-500 hover:bg-emerald-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-emerald-100/60 hover:bg-emerald-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40',
    readyStatusPill:
      'rounded-md bg-emerald-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-emerald-900',
    toolbarAccent: 'text-emerald-700',
    toolbarIconMuted: 'text-emerald-700',
    metaIconAccent: 'text-emerald-700',
    refreshHover: 'hover:border-emerald-300 hover:text-emerald-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-emerald-500/50',
  },
  blue: {
    checkboxChecked: 'border-blue-600 bg-blue-600',
    checkboxIdleHover: 'hover:border-blue-500 hover:bg-blue-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-blue-100/60 hover:bg-blue-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40',
    readyStatusPill:
      'rounded-md bg-blue-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-blue-900',
    toolbarAccent: 'text-blue-700',
    toolbarIconMuted: 'text-blue-700',
    metaIconAccent: 'text-blue-700',
    refreshHover: 'hover:border-blue-300 hover:text-blue-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-blue-500/50',
  },
  purple: {
    checkboxChecked: 'border-purple-600 bg-purple-600',
    checkboxIdleHover: 'hover:border-purple-500 hover:bg-purple-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-purple-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-purple-100/60 hover:bg-purple-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/40',
    readyStatusPill:
      'rounded-md bg-purple-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-purple-900',
    toolbarAccent: 'text-purple-700',
    toolbarIconMuted: 'text-purple-700',
    metaIconAccent: 'text-purple-700',
    refreshHover: 'hover:border-purple-300 hover:text-purple-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-purple-500/50',
  },
  yellow: {
    checkboxChecked: 'border-amber-500 bg-amber-500',
    checkboxIdleHover: 'hover:border-amber-400 hover:bg-amber-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-amber-100/60 hover:bg-amber-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40',
    readyStatusPill:
      'rounded-md bg-amber-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-amber-950',
    toolbarAccent: 'text-amber-800',
    toolbarIconMuted: 'text-amber-800',
    metaIconAccent: 'text-amber-800',
    refreshHover: 'hover:border-amber-300 hover:text-amber-800',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-amber-500/50',
  },
  black: {
    checkboxChecked: 'border-slate-900 bg-slate-900', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    checkboxIdleHover: 'hover:border-slate-600 hover:bg-surface-hover', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    checkboxFocusRing:
      // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
      'focus-visible:ring-2 focus-visible:ring-slate-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-surface-sunken/80 hover:bg-surface-sunken',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    readyStatusPill:
      'rounded-md bg-surface-strong px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-text-default',
    toolbarAccent: 'text-text-default',
    toolbarIconMuted: 'text-text-default',
    metaIconAccent: 'text-text-default',
    refreshHover: 'hover:border-border-emphasis hover:text-text-default',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-slate-500/50', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
  },
  red: {
    checkboxChecked: 'border-red-600 bg-red-600',
    checkboxIdleHover: 'hover:border-red-500 hover:bg-red-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-red-100/60 hover:bg-red-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40',
    readyStatusPill:
      'rounded-md bg-red-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-red-900',
    toolbarAccent: 'text-red-700',
    toolbarIconMuted: 'text-red-700',
    metaIconAccent: 'text-red-700',
    refreshHover: 'hover:border-red-300 hover:text-red-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-red-500/50',
  },
  lightblue: {
    checkboxChecked: 'border-sky-500 bg-sky-500',
    checkboxIdleHover: 'hover:border-sky-400 hover:bg-sky-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-sky-100/60 hover:bg-sky-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40',
    readyStatusPill:
      'rounded-md bg-sky-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-sky-950',
    toolbarAccent: 'text-sky-700',
    toolbarIconMuted: 'text-sky-700',
    metaIconAccent: 'text-sky-700',
    refreshHover: 'hover:border-sky-300 hover:text-sky-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-sky-500/50',
  },
  pink: {
    checkboxChecked: 'border-pink-500 bg-pink-500',
    checkboxIdleHover: 'hover:border-pink-400 hover:bg-pink-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-pink-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-pink-100/60 hover:bg-pink-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400/40',
    readyStatusPill:
      'rounded-md bg-pink-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-pink-950',
    toolbarAccent: 'text-pink-700',
    toolbarIconMuted: 'text-pink-700',
    metaIconAccent: 'text-pink-700',
    refreshHover: 'hover:border-pink-300 hover:text-pink-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-pink-500/50',
  },
};

export function getPrintQueueTableUi(staffId: number | string | null | undefined) {
  const theme = getStaffThemeById(staffId);
  return printQueueTableUi[theme];
}

export function getPrintQueueStationTheme(
  staffId: number | string | null | undefined
): StationTheme {
  return getStaffThemeById(staffId);
}

/**
 * FBA workspace sidebar ({@link FbaWorkspaceScanField}): tracking card + FNSKU list chrome.
 * Goal bar uses {@link stationThemeColors}[theme].`text` via `StationGoalBar` `colorClass`.
 */
export const fbaWorkspaceScanChrome: Record<
  StationTheme,
  {
    trackingCard: string;
    trackingSectionBorder: string;
    selectedItemsLabel: string;
    fnskuSubtext: string;
    fieldFocusRing: string;
    savingSpinner: string;
    /** {@link StationFbaInput} FNSKU-only scan: leading icon */
    fnskuScanIconClass: string;
    /** Typed value + placeholder + focus ring on the scan input */
    fnskuScanInputClass: string;
  }
> = {
  green: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-emerald-400/95 bg-gradient-to-b from-emerald-50/90 to-white px-3 py-3 shadow-sm shadow-emerald-100/35',
    trackingSectionBorder: 'border-t border-emerald-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-emerald-700',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-emerald-800/85',
    fieldFocusRing: 'focus:ring-emerald-500',
    savingSpinner: 'text-emerald-500',
    fnskuScanIconClass: 'text-emerald-600',
    fnskuScanInputClass:
      '!text-emerald-800 placeholder:text-emerald-400/90 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/25',
  },
  blue: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-blue-400/95 bg-gradient-to-b from-blue-50/90 to-white px-3 py-3 shadow-sm shadow-blue-100/35',
    trackingSectionBorder: 'border-t border-blue-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-blue-700',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-blue-800/85',
    fieldFocusRing: 'focus:ring-blue-500',
    savingSpinner: 'text-blue-500',
    fnskuScanIconClass: 'text-blue-600',
    fnskuScanInputClass:
      '!text-blue-800 placeholder:text-blue-400/90 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/25',
  },
  purple: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-purple-400/95 bg-gradient-to-b from-purple-50/90 to-white px-3 py-3 shadow-sm shadow-purple-100/35',
    trackingSectionBorder: 'border-t border-purple-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-purple-700',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-purple-800/85',
    fieldFocusRing: 'focus:ring-purple-500',
    savingSpinner: 'text-purple-500',
    fnskuScanIconClass: 'text-purple-600',
    fnskuScanInputClass:
      '!text-purple-800 placeholder:text-purple-400/90 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/25',
  },
  yellow: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-amber-400/95 bg-gradient-to-b from-amber-50/90 to-white px-3 py-3 shadow-sm shadow-amber-100/35',
    trackingSectionBorder: 'border-t border-amber-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-amber-800',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-amber-900/80',
    fieldFocusRing: 'focus:ring-amber-500',
    savingSpinner: 'text-amber-600',
    fnskuScanIconClass: 'text-amber-600',
    fnskuScanInputClass:
      '!text-amber-900 placeholder:text-amber-500/80 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/25',
  },
  black: {
    trackingCard:
      // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
      'space-y-3 rounded-xl border-2 border-slate-500/90 bg-gradient-to-b from-slate-50/90 to-white px-3 py-3 shadow-sm shadow-slate-200/40',
    trackingSectionBorder: 'border-t border-border-emphasis',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-text-default',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-text-muted',
    fieldFocusRing: 'focus:ring-slate-500', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    savingSpinner: 'text-text-soft',
    fnskuScanIconClass: 'text-text-muted',
    fnskuScanInputClass:
      // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
      '!text-text-default placeholder:text-text-faint focus:border-border-emphasis focus:ring-2 focus:ring-slate-500/25',
  },
  red: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-red-400/95 bg-gradient-to-b from-red-50/90 to-white px-3 py-3 shadow-sm shadow-red-100/35',
    trackingSectionBorder: 'border-t border-red-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-red-700',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-red-800/85',
    fieldFocusRing: 'focus:ring-red-500',
    savingSpinner: 'text-red-500',
    fnskuScanIconClass: 'text-red-600',
    fnskuScanInputClass:
      '!text-red-800 placeholder:text-red-400/90 focus:border-red-400 focus:ring-2 focus:ring-red-500/25',
  },
  lightblue: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-sky-400/95 bg-gradient-to-b from-sky-50/90 to-white px-3 py-3 shadow-sm shadow-sky-100/35',
    trackingSectionBorder: 'border-t border-sky-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-sky-700',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-sky-800/85',
    fieldFocusRing: 'focus:ring-sky-500',
    savingSpinner: 'text-sky-500',
    fnskuScanIconClass: 'text-sky-500',
    fnskuScanInputClass:
      '!text-sky-800 placeholder:text-sky-400/90 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/25',
  },
  pink: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-pink-400/95 bg-gradient-to-b from-pink-50/90 to-white px-3 py-3 shadow-sm shadow-pink-100/35',
    trackingSectionBorder: 'border-t border-pink-300',
    selectedItemsLabel: 'text-eyebrow font-black uppercase tracking-[0.14em] text-pink-700',
    fnskuSubtext:
      'font-mono text-micro font-semibold uppercase tracking-[0.12em] text-pink-800/85',
    fieldFocusRing: 'focus:ring-pink-500',
    savingSpinner: 'text-pink-500',
    fnskuScanIconClass: 'text-pink-600',
    fnskuScanInputClass:
      '!text-pink-800 placeholder:text-pink-400/90 focus:border-pink-400 focus:ring-2 focus:ring-pink-500/25',
  },
};

/**
 * FBA plan / FNSKU checklist main column: same gradient family as {@link fbaWorkspaceScanChrome}.`trackingCard`,
 * with a darker frame than the sidebar tracking card (`border-*-600` vs `border-*-400/95`).
 */
export const fbaFnskuChecklistChrome: Record<
  StationTheme,
  { shell: string; headerBarDivider: string }
> = {
  green: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-emerald-600/90 bg-gradient-to-b from-emerald-50/88 via-white to-stone-50 shadow-md shadow-emerald-200/25',
    headerBarDivider: 'border-b-2 border-emerald-300',
  },
  blue: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-blue-600/90 bg-gradient-to-b from-blue-50/88 via-white to-stone-50 shadow-md shadow-blue-200/25',
    headerBarDivider: 'border-b-2 border-blue-300',
  },
  purple: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-purple-600/90 bg-gradient-to-b from-purple-50/88 via-white to-stone-50 shadow-md shadow-purple-200/25',
    headerBarDivider: 'border-b-2 border-purple-300',
  },
  yellow: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-amber-500/90 bg-gradient-to-b from-amber-50/88 via-white to-stone-50 shadow-md shadow-amber-200/25',
    headerBarDivider: 'border-b-2 border-amber-300',
  },
  black: {
    shell:
      // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-slate-700/95 bg-gradient-to-b from-slate-50/90 via-white to-stone-50 shadow-md shadow-slate-300/30',
    headerBarDivider: 'border-b-2 border-border-emphasis',
  },
  red: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-red-600/90 bg-gradient-to-b from-red-50/88 via-white to-stone-50 shadow-md shadow-red-200/25',
    headerBarDivider: 'border-b-2 border-red-300',
  },
  lightblue: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-sky-600/90 bg-gradient-to-b from-sky-50/88 via-white to-stone-50 shadow-md shadow-sky-200/25',
    headerBarDivider: 'border-b-2 border-sky-300',
  },
  pink: {
    shell:
      'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 border-pink-600/90 bg-gradient-to-b from-pink-50/88 via-white to-stone-50 shadow-md shadow-pink-200/25',
    headerBarDivider: 'border-b-2 border-pink-300',
  },
};

export interface FbaSidebarThemeChrome {
  sectionRule: string;
  sectionLabel: string;
  loading: string;
  emptyShell: string;
  emptyLabel: string;
  emptyIcon: string;
  cardActive: string;
  cardIdle: string;
  cardFocusRing: string;
  cardDateText: string;
  cardOpenPill: string;
  cardChevron: string;
  cardExpandedDivider: string;
  cardQtyInput: string;
  cardProgress: string;
  selectedRow: string;
  selectedCountText: string;
  scanResultsShell: string;
  scanResultsTitle: string;
  scanResultsCount: string;
  scanResultsQtyStepper: string;
  scanResultsHint: string;
  secondaryButton: string;
  input: string;
  monoInput: string;
  primaryButton: string;
  lineItemShell: string;
  lineItemLabel: string;
}

export const fbaSidebarThemeChrome: Record<StationTheme, FbaSidebarThemeChrome> = {
  green: {
    sectionRule: 'bg-emerald-200',
    sectionLabel: 'text-emerald-700',
    loading: 'text-emerald-300',
    emptyShell: 'rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3',
    emptyLabel: 'text-emerald-400',
    emptyIcon: 'text-emerald-200',
    cardActive: 'bg-surface-card border-emerald-500',
    cardIdle: 'bg-surface-card border-emerald-300 hover:border-emerald-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-emerald-400/50',
    cardDateText: 'text-sm font-black text-emerald-700',
    cardOpenPill:
      'rounded-full bg-emerald-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-emerald-800',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 text-emerald-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(16,185,129,0.16)]',
    cardExpandedDivider: 'border-t border-emerald-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-emerald-400',
    cardProgress: 'h-full rounded-full bg-emerald-400',
    selectedRow: 'border-l-4 border-l-emerald-400 bg-emerald-100/60 hover:bg-emerald-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-emerald-700',
    scanResultsShell: 'rounded-xl border border-emerald-200 bg-emerald-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-emerald-800',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-emerald-700',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-emerald-200 bg-emerald-50',
    scanResultsHint: 'text-micro text-emerald-700',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-emerald-700 transition-all hover:bg-emerald-100',
    input:
      'w-full rounded-xl border-2 border-emerald-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-emerald-500',
    monoInput:
      'w-full rounded-xl border-2 border-emerald-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-emerald-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-emerald-500/20 hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-emerald-700',
  },
  blue: {
    sectionRule: 'bg-blue-200',
    sectionLabel: 'text-blue-700',
    loading: 'text-blue-300',
    emptyShell: 'rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3',
    emptyLabel: 'text-blue-400',
    emptyIcon: 'text-blue-200',
    cardActive: 'bg-surface-card border-blue-500',
    cardIdle: 'bg-surface-card border-blue-300 hover:border-blue-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-blue-400/50',
    cardDateText: 'text-sm font-black text-blue-700',
    cardOpenPill:
      'rounded-full bg-blue-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-blue-800',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 text-blue-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(37,99,235,0.16)]',
    cardExpandedDivider: 'border-t border-blue-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-blue-400',
    cardProgress: 'h-full rounded-full bg-blue-400',
    selectedRow: 'border-l-4 border-l-blue-400 bg-blue-100/60 hover:bg-blue-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-blue-700',
    scanResultsShell: 'rounded-xl border border-blue-200 bg-blue-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-blue-800',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-blue-700',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-blue-200 bg-blue-50',
    scanResultsHint: 'text-micro text-blue-700',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-blue-700 transition-all hover:bg-blue-100',
    input:
      'w-full rounded-xl border-2 border-blue-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-blue-500',
    monoInput:
      'w-full rounded-xl border-2 border-blue-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-blue-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-blue-500/20 hover:from-blue-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-blue-100 bg-blue-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-blue-700',
  },
  purple: {
    sectionRule: 'bg-purple-200',
    sectionLabel: 'text-purple-700',
    loading: 'text-purple-300',
    emptyShell: 'rounded-2xl border border-purple-100 bg-purple-50/70 px-4 py-3',
    emptyLabel: 'text-purple-400',
    emptyIcon: 'text-purple-200',
    cardActive: 'bg-surface-card border-purple-500',
    cardIdle: 'bg-surface-card border-purple-300 hover:border-purple-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-purple-400/50',
    cardDateText: 'text-sm font-black text-purple-700',
    cardOpenPill:
      'rounded-full bg-purple-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-purple-800',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-purple-200 text-purple-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(147,51,234,0.16)]',
    cardExpandedDivider: 'border-t border-purple-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-purple-400',
    cardProgress: 'h-full rounded-full bg-purple-400',
    selectedRow: 'border-l-4 border-l-purple-400 bg-purple-100/60 hover:bg-purple-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-purple-700',
    scanResultsShell: 'rounded-xl border border-purple-200 bg-purple-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-purple-800',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-purple-700',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-purple-200 bg-purple-50',
    scanResultsHint: 'text-micro text-purple-700',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-purple-700 transition-all hover:bg-purple-100',
    input:
      'w-full rounded-xl border-2 border-purple-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-purple-500',
    monoInput:
      'w-full rounded-xl border-2 border-purple-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-purple-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-purple-500/20 hover:from-purple-700 hover:to-fuchsia-700 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-purple-100 bg-purple-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-purple-700',
  },
  yellow: {
    sectionRule: 'bg-amber-200',
    sectionLabel: 'text-amber-700',
    loading: 'text-amber-300',
    emptyShell: 'rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3',
    emptyLabel: 'text-amber-500',
    emptyIcon: 'text-amber-200',
    cardActive: 'bg-surface-card border-amber-500',
    cardIdle: 'bg-surface-card border-amber-300 hover:border-amber-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-amber-400/50',
    cardDateText: 'text-sm font-black text-amber-800',
    cardOpenPill:
      'rounded-full bg-amber-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-amber-900',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 text-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(245,158,11,0.16)]',
    cardExpandedDivider: 'border-t border-amber-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-amber-400',
    cardProgress: 'h-full rounded-full bg-amber-400',
    selectedRow: 'border-l-4 border-l-amber-400 bg-amber-100/60 hover:bg-amber-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-amber-800',
    scanResultsShell: 'rounded-xl border border-amber-200 bg-amber-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-amber-900',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-amber-800',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-amber-200 bg-amber-50',
    scanResultsHint: 'text-micro text-amber-800',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-amber-800 transition-all hover:bg-amber-100',
    input:
      'w-full rounded-xl border-2 border-amber-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-amber-500',
    monoInput:
      'w-full rounded-xl border-2 border-amber-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-amber-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-amber-500/20 hover:from-amber-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-amber-800',
  },
  black: {
    sectionRule: 'bg-surface-strong',
    sectionLabel: 'text-text-muted',
    loading: 'text-text-faint',
    emptyShell: 'rounded-2xl border border-border-soft bg-surface-canvas/80 px-4 py-3',
    emptyLabel: 'text-text-soft',
    emptyIcon: 'text-slate-300', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    cardActive: 'bg-surface-card border-slate-500', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    cardIdle: 'bg-surface-card border-border-default hover:border-slate-500', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-slate-400/50', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    cardDateText: 'text-sm font-black text-text-default',
    cardOpenPill:
      'rounded-full bg-surface-strong px-2 py-0.5 text-mini font-black uppercase tracking-wide text-text-default',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-default text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(71,85,105,0.16)]',
    cardExpandedDivider: 'border-t border-border-soft',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-border-emphasis',
    cardProgress: 'h-full rounded-full bg-slate-500', // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
    selectedRow: 'border-l-4 border-l-border-emphasis bg-surface-sunken/80 hover:bg-surface-sunken',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-text-muted',
    scanResultsShell: 'rounded-xl border border-border-soft bg-surface-canvas/80 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-text-default',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-text-muted',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-border-default bg-surface-sunken',
    scanResultsHint: 'text-micro text-text-muted',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-border-default bg-surface-sunken px-3 py-2 text-micro font-black uppercase tracking-wide text-text-muted transition-all hover:bg-surface-strong',
    input:
      // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
      'w-full rounded-xl border-2 border-border-soft bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-slate-500',
    monoInput:
      // ds-allow-raw-neutral: identity hue — staff/label color vocabulary, not chrome
      'w-full rounded-xl border-2 border-border-soft bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-slate-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-slate-500/20 hover:from-slate-800 hover:to-black disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-border-soft bg-surface-canvas/80 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-text-muted',
  },
  red: {
    sectionRule: 'bg-red-200',
    sectionLabel: 'text-red-700',
    loading: 'text-red-300',
    emptyShell: 'rounded-2xl border border-red-100 bg-red-50/70 px-4 py-3',
    emptyLabel: 'text-red-400',
    emptyIcon: 'text-red-200',
    cardActive: 'bg-surface-card border-red-500',
    cardIdle: 'bg-surface-card border-red-300 hover:border-red-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-red-400/50',
    cardDateText: 'text-sm font-black text-red-700',
    cardOpenPill:
      'rounded-full bg-red-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-red-800',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 text-red-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(220,38,38,0.16)]',
    cardExpandedDivider: 'border-t border-red-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-red-400',
    cardProgress: 'h-full rounded-full bg-red-400',
    selectedRow: 'border-l-4 border-l-red-400 bg-red-100/60 hover:bg-red-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-red-700',
    scanResultsShell: 'rounded-xl border border-red-200 bg-red-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-red-800',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-red-700',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-red-200 bg-red-50',
    scanResultsHint: 'text-micro text-red-700',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-red-700 transition-all hover:bg-red-100',
    input:
      'w-full rounded-xl border-2 border-red-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-red-500',
    monoInput:
      'w-full rounded-xl border-2 border-red-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-red-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-600 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-red-500/20 hover:from-red-700 hover:to-rose-700 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-red-100 bg-red-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-red-700',
  },
  lightblue: {
    sectionRule: 'bg-sky-200',
    sectionLabel: 'text-sky-700',
    loading: 'text-sky-300',
    emptyShell: 'rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3',
    emptyLabel: 'text-sky-400',
    emptyIcon: 'text-sky-200',
    cardActive: 'bg-surface-card border-sky-500',
    cardIdle: 'bg-surface-card border-sky-300 hover:border-sky-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-sky-400/50',
    cardDateText: 'text-sm font-black text-sky-700',
    cardOpenPill:
      'rounded-full bg-sky-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-sky-800',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(14,165,233,0.16)]',
    cardExpandedDivider: 'border-t border-sky-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-sky-400',
    cardProgress: 'h-full rounded-full bg-sky-400',
    selectedRow: 'border-l-4 border-l-sky-400 bg-sky-100/60 hover:bg-sky-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-sky-700',
    scanResultsShell: 'rounded-xl border border-sky-200 bg-sky-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-sky-800',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-sky-700',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-sky-200 bg-sky-50',
    scanResultsHint: 'text-micro text-sky-700',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-sky-700 transition-all hover:bg-sky-100',
    input:
      'w-full rounded-xl border-2 border-sky-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-sky-500',
    monoInput:
      'w-full rounded-xl border-2 border-sky-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-sky-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-sky-500/20 hover:from-sky-600 hover:to-cyan-600 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-sky-700',
  },
  pink: {
    sectionRule: 'bg-pink-200',
    sectionLabel: 'text-pink-700',
    loading: 'text-pink-300',
    emptyShell: 'rounded-2xl border border-pink-100 bg-pink-50/70 px-4 py-3',
    emptyLabel: 'text-pink-400',
    emptyIcon: 'text-pink-200',
    cardActive: 'bg-surface-card border-pink-500',
    cardIdle: 'bg-surface-card border-pink-300 hover:border-pink-500',
    cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-pink-400/50',
    cardDateText: 'text-sm font-black text-pink-700',
    cardOpenPill:
      'rounded-full bg-pink-100 px-2 py-0.5 text-mini font-black uppercase tracking-wide text-pink-800',
    cardChevron:
      'inline-flex h-8 w-8 items-center justify-center rounded-full border border-pink-200 text-pink-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(236,72,153,0.16)]',
    cardExpandedDivider: 'border-t border-pink-100',
    cardQtyInput:
      'w-14 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-center text-micro font-black tabular-nums text-text-default outline-none focus:border-pink-400',
    cardProgress: 'h-full rounded-full bg-pink-400',
    selectedRow: 'border-l-4 border-l-pink-400 bg-pink-100/60 hover:bg-pink-100/80',
    selectedCountText: 'text-eyebrow font-black uppercase tracking-[0.16em] text-pink-700',
    scanResultsShell: 'rounded-xl border border-pink-200 bg-pink-50/60 px-2.5 py-2',
    scanResultsTitle: 'text-micro font-semibold uppercase tracking-widest text-pink-800',
    scanResultsCount: 'text-micro font-semibold tabular-nums text-pink-700',
    scanResultsQtyStepper:
      'flex w-8 flex-col items-center justify-center rounded-md border border-pink-200 bg-pink-50',
    scanResultsHint: 'text-micro text-pink-700',
    secondaryButton:
      'inline-flex items-center gap-1 rounded-xl border border-pink-200 bg-pink-50 px-3 py-2 text-micro font-black uppercase tracking-wide text-pink-700 transition-all hover:bg-pink-100',
    input:
      'w-full rounded-xl border-2 border-pink-200 bg-surface-card px-4 py-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-pink-500',
    monoInput:
      'w-full rounded-xl border-2 border-pink-200 bg-surface-card px-4 py-3 text-sm font-semibold font-mono text-text-default outline-none transition-all placeholder:text-text-faint focus:border-transparent focus:ring-2 focus:ring-pink-500',
    primaryButton:
      'w-full rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all shadow-lg shadow-pink-500/20 hover:from-pink-600 hover:to-rose-600 disabled:cursor-not-allowed disabled:bg-surface-strong',
    lineItemShell: 'space-y-2 rounded-xl border border-pink-100 bg-pink-50/50 p-3',
    lineItemLabel: 'text-micro font-black uppercase tracking-widest text-pink-700',
  },
};

export function getFbaWorkspaceScanChrome(staffId: number | string | null | undefined) {
  const theme = getStaffThemeById(staffId);
  return fbaWorkspaceScanChrome[theme];
}
