export type StationTheme = 'green' | 'purple' | 'blue' | 'yellow' | 'black' | 'red' | 'lightblue' | 'pink';
export type TechStationTheme = 'green' | 'purple' | 'blue' | 'yellow';
export type PackerStationTheme = 'black' | 'red';

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
    bg: 'bg-slate-900',
    hover: 'hover:bg-slate-800',
    light: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-900',
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

export const stationThemeClasses: Record<
  StationTheme,
  {
    active: string;
    inactive: string;
  }
> = {
  green: {
    active: 'bg-emerald-600 text-white border-emerald-600',
    inactive: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
  blue: {
    active: 'bg-blue-600 text-white border-blue-600',
    inactive: 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50',
  },
  purple: {
    active: 'bg-purple-600 text-white border-purple-600',
    inactive: 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50',
  },
  yellow: {
    active: 'bg-amber-500 text-white border-amber-500',
    inactive: 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50',
  },
  black: {
    active: 'bg-slate-900 text-white border-slate-900',
    inactive: 'bg-slate-100 text-slate-900 border-slate-300 hover:bg-slate-200',
  },
  red: {
    active: 'bg-red-600 text-white border-red-600',
    inactive: 'bg-white text-red-700 border-red-200 hover:bg-red-50',
  },
  lightblue: {
    active: 'bg-sky-400 text-white border-sky-400',
    inactive: 'bg-white text-sky-600 border-sky-200 hover:bg-sky-50',
  },
  pink: {
    active: 'bg-pink-500 text-white border-pink-500',
    inactive: 'bg-white text-pink-600 border-pink-200 hover:bg-pink-50',
  },
};

export const packerInputThemeClasses: Record<PackerStationTheme, StationInputThemeClasses> = {
  black: {
    text: 'text-slate-900',
    bg: 'bg-slate-900',
    ring: 'focus:ring-slate-500/10',
    border: 'focus:border-slate-500',
  },
  red: {
    text: 'text-red-600',
    bg: 'bg-red-600',
    ring: 'focus:ring-red-500/10',
    border: 'focus:border-red-500',
  },
};

const STAFF_THEME_BY_ID: Partial<Record<number, StationTheme>> = {
  7: 'lightblue',
  8: 'pink',
};

const TECH_THEME_BY_STATION_ID: Record<number, TechStationTheme> = {
  1: 'green',
  2: 'blue',
  3: 'purple',
  4: 'yellow',
  6: 'yellow',
};

const PACKER_THEME_BY_STATION_ID: Record<number, PackerStationTheme> = {
  1: 'black',
  2: 'red',
};

const PACKER_THEME_BY_STAFF_ID: Record<number, PackerStationTheme> = {
  4: 'black',
  5: 'red',
};

const TECH_THEME_BY_NAME: Record<string, StationTheme> = {
  michael: 'green',
  sang: 'purple',
  thuc: 'blue',
  cuong: 'yellow',
};

const PACKER_THEME_BY_NAME: Record<string, StationTheme> = {
  tuan: 'black',
  thuy: 'red',
};

function parseStaffId(staffId: number | string | null | undefined): number | null {
  const parsed = Number(staffId);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getTechThemeById(techId: number | string | null | undefined): TechStationTheme {
  const id = parseStaffId(techId);
  if (!id) return 'green';
  return TECH_THEME_BY_STATION_ID[id] || 'green';
}

export function getPackerThemeById(packerId: number | string | null | undefined): PackerStationTheme {
  const id = parseStaffId(packerId);
  if (!id) return 'black';
  return PACKER_THEME_BY_STATION_ID[id] || PACKER_THEME_BY_STAFF_ID[id] || 'black';
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

export function getStaffThemeById(
  staffId: number | string | null | undefined,
  role: 'technician' | 'packer'
): StationTheme {
  const id = parseStaffId(staffId);
  if (id && STAFF_THEME_BY_ID[id]) return STAFF_THEME_BY_ID[id]!;
  return role === 'technician' ? getTechThemeById(staffId) : getPackerThemeById(staffId);
}

export function getStaffThemeByName(name: string, role?: string): StationTheme {
  const key = String(name || '').trim().toLowerCase();
  if (role === 'packer') return PACKER_THEME_BY_NAME[key] || 'black';
  if (role === 'technician') return TECH_THEME_BY_NAME[key] || 'green';
  return TECH_THEME_BY_NAME[key] || PACKER_THEME_BY_NAME[key] || 'blue';
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
      'rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-900',
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
      'rounded-md bg-blue-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-blue-900',
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
      'rounded-md bg-purple-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-purple-900',
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
      'rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-950',
    toolbarAccent: 'text-amber-800',
    toolbarIconMuted: 'text-amber-800',
    metaIconAccent: 'text-amber-800',
    refreshHover: 'hover:border-amber-300 hover:text-amber-800',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-amber-500/50',
  },
  black: {
    checkboxChecked: 'border-slate-900 bg-slate-900',
    checkboxIdleHover: 'hover:border-slate-600 hover:bg-slate-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-slate-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-slate-100/80 hover:bg-slate-100',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
    readyStatusPill:
      'rounded-md bg-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-900',
    toolbarAccent: 'text-slate-800',
    toolbarIconMuted: 'text-slate-800',
    metaIconAccent: 'text-slate-800',
    refreshHover: 'hover:border-slate-400 hover:text-slate-800',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-slate-500/50',
  },
  red: {
    checkboxChecked: 'border-red-600 bg-red-600',
    checkboxIdleHover: 'hover:border-red-500 hover:bg-red-50',
    checkboxFocusRing:
      'focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    rowSelected: 'bg-red-100/60 hover:bg-red-100/80',
    rowFocusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40',
    readyStatusPill:
      'rounded-md bg-red-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-red-900',
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
      'rounded-md bg-sky-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-sky-950',
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
      'rounded-md bg-pink-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-pink-950',
    toolbarAccent: 'text-pink-700',
    toolbarIconMuted: 'text-pink-700',
    metaIconAccent: 'text-pink-700',
    refreshHover: 'hover:border-pink-300 hover:text-pink-700',
    statusFocusRing: 'focus-visible:ring-2 focus-visible:ring-pink-500/50',
  },
};

export function getPrintQueueTableUi(staffId: number | string | null | undefined) {
  const theme = getStaffThemeById(staffId, 'technician');
  return printQueueTableUi[theme];
}

export function getPrintQueueStationTheme(
  staffId: number | string | null | undefined
): StationTheme {
  return getStaffThemeById(staffId, 'technician');
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
      'space-y-3 rounded-xl border-2 border-emerald-200/90 bg-gradient-to-b from-emerald-50/90 to-white px-3 py-3 shadow-sm shadow-emerald-100/35',
    trackingSectionBorder: 'border-t border-emerald-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-800/85',
    fieldFocusRing: 'focus:ring-emerald-500',
    savingSpinner: 'text-emerald-500',
    fnskuScanIconClass: 'text-emerald-600',
    fnskuScanInputClass:
      '!text-emerald-800 placeholder:text-emerald-400/90 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/25',
  },
  blue: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-blue-200/90 bg-gradient-to-b from-blue-50/90 to-white px-3 py-3 shadow-sm shadow-blue-100/35',
    trackingSectionBorder: 'border-t border-blue-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-blue-700',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800/85',
    fieldFocusRing: 'focus:ring-blue-500',
    savingSpinner: 'text-blue-500',
    fnskuScanIconClass: 'text-blue-600',
    fnskuScanInputClass:
      '!text-blue-800 placeholder:text-blue-400/90 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/25',
  },
  purple: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-purple-200/90 bg-gradient-to-b from-purple-50/90 to-white px-3 py-3 shadow-sm shadow-purple-100/35',
    trackingSectionBorder: 'border-t border-purple-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-purple-700',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-purple-800/85',
    fieldFocusRing: 'focus:ring-purple-500',
    savingSpinner: 'text-purple-500',
    fnskuScanIconClass: 'text-purple-600',
    fnskuScanInputClass:
      '!text-purple-800 placeholder:text-purple-400/90 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/25',
  },
  yellow: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-amber-200/90 bg-gradient-to-b from-amber-50/90 to-white px-3 py-3 shadow-sm shadow-amber-100/35',
    trackingSectionBorder: 'border-t border-amber-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-amber-800',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-900/80',
    fieldFocusRing: 'focus:ring-amber-500',
    savingSpinner: 'text-amber-600',
    fnskuScanIconClass: 'text-amber-600',
    fnskuScanInputClass:
      '!text-amber-900 placeholder:text-amber-500/80 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/25',
  },
  black: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-slate-300/90 bg-gradient-to-b from-slate-50/90 to-white px-3 py-3 shadow-sm shadow-slate-200/40',
    trackingSectionBorder: 'border-t border-slate-200',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-slate-800',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600',
    fieldFocusRing: 'focus:ring-slate-500',
    savingSpinner: 'text-slate-500',
    fnskuScanIconClass: 'text-slate-700',
    fnskuScanInputClass:
      '!text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-500/25',
  },
  red: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-red-200/90 bg-gradient-to-b from-red-50/90 to-white px-3 py-3 shadow-sm shadow-red-100/35',
    trackingSectionBorder: 'border-t border-red-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-red-700',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-red-800/85',
    fieldFocusRing: 'focus:ring-red-500',
    savingSpinner: 'text-red-500',
    fnskuScanIconClass: 'text-red-600',
    fnskuScanInputClass:
      '!text-red-800 placeholder:text-red-400/90 focus:border-red-400 focus:ring-2 focus:ring-red-500/25',
  },
  lightblue: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-sky-200/90 bg-gradient-to-b from-sky-50/90 to-white px-3 py-3 shadow-sm shadow-sky-100/35',
    trackingSectionBorder: 'border-t border-sky-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-sky-700',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-800/85',
    fieldFocusRing: 'focus:ring-sky-500',
    savingSpinner: 'text-sky-500',
    fnskuScanIconClass: 'text-sky-500',
    fnskuScanInputClass:
      '!text-sky-800 placeholder:text-sky-400/90 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/25',
  },
  pink: {
    trackingCard:
      'space-y-3 rounded-xl border-2 border-pink-200/90 bg-gradient-to-b from-pink-50/90 to-white px-3 py-3 shadow-sm shadow-pink-100/35',
    trackingSectionBorder: 'border-t border-pink-100',
    selectedItemsLabel: 'text-[9px] font-black uppercase tracking-[0.14em] text-pink-700',
    fnskuSubtext:
      'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-pink-800/85',
    fieldFocusRing: 'focus:ring-pink-500',
    savingSpinner: 'text-pink-500',
    fnskuScanIconClass: 'text-pink-600',
    fnskuScanInputClass:
      '!text-pink-800 placeholder:text-pink-400/90 focus:border-pink-400 focus:ring-2 focus:ring-pink-500/25',
  },
};

export function getFbaWorkspaceScanChrome(staffId: number | string | null | undefined) {
  const theme = getStaffThemeById(staffId, 'technician');
  return fbaWorkspaceScanChrome[theme];
}
