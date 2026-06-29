import type { ConditionGrade } from '@/lib/conditions';

/** Visual tone per condition grade — shared by picker pills and inline badges. */
export type ConditionGradeTone = {
  /** Selected pill (filled). */
  active: string;
  /** Unselected pill (outline). */
  inactive: string;
  /** Inline text/badge color matching the active pill hue. */
  text: string;
  /** {@link CopyChip} underline border — matches active pill hue. */
  chipUnderline: string;
  /** {@link CopyChip} icon color — matches active pill hue. */
  chipIconClass: string;
};

/**
 * Single source of truth for condition-grade color. {@link ConditionPills} and
 * inline meta badges (PO line rows, unit slots) import from here so a grade
 * always reads the same hue everywhere.
 */
export const CONDITION_GRADE_TONE: Record<ConditionGrade, ConditionGradeTone> = {
  BRAND_NEW: {
    active: 'bg-yellow-500 text-white shadow-sm shadow-yellow-200 ring-yellow-600',
    inactive: 'bg-white text-yellow-800 ring-yellow-200 hover:bg-yellow-50',
    text: 'text-yellow-600',
    chipUnderline: 'border-yellow-500',
    chipIconClass: 'inline-flex items-center justify-center text-yellow-600',
  },
  LIKE_NEW: {
    active: 'bg-teal-600 text-white shadow-sm shadow-teal-200 ring-teal-700',
    inactive: 'bg-white text-teal-800 ring-teal-200 hover:bg-teal-50',
    text: 'text-teal-600',
    chipUnderline: 'border-teal-600',
    chipIconClass: 'inline-flex items-center justify-center text-teal-600',
  },
  REFURBISHED: {
    active: 'bg-indigo-600 text-white shadow-sm shadow-indigo-200 ring-indigo-700',
    inactive: 'bg-white text-indigo-800 ring-indigo-200 hover:bg-indigo-50',
    text: 'text-indigo-600',
    chipUnderline: 'border-indigo-600',
    chipIconClass: 'inline-flex items-center justify-center text-indigo-600',
  },
  USED_A: {
    active: 'bg-emerald-600 text-white shadow-sm shadow-emerald-200 ring-emerald-700',
    inactive: 'bg-white text-emerald-800 ring-emerald-200 hover:bg-emerald-50',
    text: 'text-emerald-600',
    chipUnderline: 'border-emerald-500',
    chipIconClass: 'inline-flex items-center justify-center text-emerald-600',
  },
  USED_B: {
    active: 'bg-blue-600 text-white shadow-sm shadow-blue-200 ring-blue-700',
    inactive: 'bg-white text-blue-800 ring-blue-200 hover:bg-blue-50',
    text: 'text-blue-600',
    chipUnderline: 'border-blue-500',
    chipIconClass: 'inline-flex items-center justify-center text-blue-600',
  },
  USED_C: {
    active: 'bg-slate-700 text-white shadow-sm shadow-slate-300 ring-slate-800',
    inactive: 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
    text: 'text-slate-700',
    chipUnderline: 'border-slate-600',
    chipIconClass: 'inline-flex items-center justify-center text-slate-700',
  },
  PARTS: {
    active: 'bg-amber-700 text-white shadow-sm shadow-amber-200 ring-amber-800',
    inactive: 'bg-white text-amber-800 ring-amber-200 hover:bg-amber-50',
    text: 'text-amber-700',
    chipUnderline: 'border-amber-600',
    chipIconClass: 'inline-flex items-center justify-center text-amber-700',
  },
};

const FALLBACK_TONE = CONDITION_GRADE_TONE.USED_C;

export function normalizeConditionGrade(code: string | null | undefined): string {
  return String(code || '').trim().toUpperCase();
}

export function conditionGradeTone(code: string | null | undefined): ConditionGradeTone {
  const c = normalizeConditionGrade(code) as ConditionGrade;
  return CONDITION_GRADE_TONE[c] ?? FALLBACK_TONE;
}

/** Text color class for inline condition labels (meta rows, badges). */
export function conditionGradeTextClass(code: string | null | undefined): string {
  return conditionGradeTone(code).text;
}

/** Underline + icon classes for a {@link CopyChip} condition readout. */
export function conditionGradeChipStyle(code: string | null | undefined): {
  underline: string;
  iconClass: string;
} {
  const tone = conditionGradeTone(code);
  return { underline: tone.chipUnderline, iconClass: tone.chipIconClass };
}

const PENDING_CHIP_STYLE = {
  underline: 'border-gray-400',
  iconClass: 'inline-flex items-center justify-center text-gray-400',
} as const;

export function conditionGradeChipStyleOrPending(code: string | null | undefined): {
  underline: string;
  iconClass: string;
  isPending: boolean;
} {
  const normalized = normalizeConditionGrade(code);
  const isPending = !normalized || normalized === 'PENDING';
  if (isPending) return { ...PENDING_CHIP_STYLE, isPending: true };
  return { ...conditionGradeChipStyle(normalized), isPending: false };
}

/** Tailwind classes for a single condition picker pill. */
export function conditionPillClass(gradeValue: string, isActive: boolean): string {
  const tone = conditionGradeTone(gradeValue);
  return `inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-caption font-black uppercase tracking-[0.1em] ring-1 ring-inset transition-colors active:scale-[0.98] ${
    isActive ? tone.active : tone.inactive
  }`;
}
