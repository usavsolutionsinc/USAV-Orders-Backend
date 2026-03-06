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
