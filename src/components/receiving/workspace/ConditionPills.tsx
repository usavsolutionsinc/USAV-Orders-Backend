'use client';

import { useRef, useState } from 'react';
import { Pencil } from '@/components/Icons';
import { CONDITION_GRADES, conditionLabel } from '@/lib/conditions';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
  /**
   * When set, the picker starts as the full row (PO just opened → pick a
   * grade) and collapses to ONLY the selected pill + an edit pencil once a
   * grade is chosen — mirroring the serial copy-chip. Clicking the pencil (or
   * the pill) re-expands the full row.
   */
  collapsible?: boolean;
  /**
   * Controlled expanded state (collapsible mode only). When provided, the
   * parent owns expand/collapse — e.g. SerialCard collapses the picker while a
   * serial is being edited. Leave undefined to let the component self-manage.
   */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

// Per-grade visual tone — selected = filled, unselected = soft outline.
const TONE: Record<string, { active: string; inactive: string }> = {
  BRAND_NEW: {
    active: 'bg-yellow-500 text-white shadow-sm shadow-yellow-200 ring-yellow-600',
    inactive: 'bg-white text-yellow-800 ring-yellow-200 hover:bg-yellow-50',
  },
  LIKE_NEW: {
    active: 'bg-teal-600 text-white shadow-sm shadow-teal-200 ring-teal-700',
    inactive: 'bg-white text-teal-800 ring-teal-200 hover:bg-teal-50',
  },
  REFURBISHED: {
    active: 'bg-indigo-600 text-white shadow-sm shadow-indigo-200 ring-indigo-700',
    inactive: 'bg-white text-indigo-800 ring-indigo-200 hover:bg-indigo-50',
  },
  USED_A: {
    active: 'bg-emerald-600 text-white shadow-sm shadow-emerald-200 ring-emerald-700',
    inactive: 'bg-white text-emerald-800 ring-emerald-200 hover:bg-emerald-50',
  },
  USED_B: {
    active: 'bg-blue-600 text-white shadow-sm shadow-blue-200 ring-blue-700',
    inactive: 'bg-white text-blue-800 ring-blue-200 hover:bg-blue-50',
  },
  USED_C: {
    active: 'bg-slate-700 text-white shadow-sm shadow-slate-300 ring-slate-800',
    inactive: 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
  },
  PARTS: {
    active: 'bg-amber-700 text-white shadow-sm shadow-amber-200 ring-amber-800',
    inactive: 'bg-white text-amber-800 ring-amber-200 hover:bg-amber-50',
  },
};

// Single flat row of grades, in display order. Used grades (A / B / C) are
// shown bare; retail-ready grades + parts follow — no "USED"/"NEW+" parents.
// Labels come from the shared `pill` variant (src/lib/conditions.ts) so the
// picker copy stays in lockstep with every other grade display.
const GRADES = CONDITION_GRADES.map((value) => ({
  value,
  label: conditionLabel(value, 'pill'),
}));

const pillClass = (gradeValue: string, isActive: boolean) => {
  const tone = TONE[gradeValue] ?? TONE.USED_C;
  return `inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-caption font-black uppercase tracking-[0.1em] ring-1 ring-inset transition-colors active:scale-[0.98] ${
    isActive ? tone.active : tone.inactive
  }`;
};

/**
 * Bare, mobile-first condition picker. Renders every grade as a single
 * horizontally-scrolling row of pills — no nested parents. In `collapsible`
 * mode it folds to the selected pill + an edit pencil after a grade is chosen.
 */
export function ConditionPills({
  value,
  onChange,
  collapsible = false,
  expanded: expandedProp,
  onExpandedChange,
}: Props) {
  const selected = String(value || '').trim().toUpperCase();
  const selectedGrade = GRADES.find((g) => g.value === selected) ?? null;
  // The scrollbar is hidden, so without this a mouse wheel scrolls the parent
  // panel vertically and the overflowing grades (USED_C / PARTS) are
  // unreachable in narrow hosts like the shipped details sidebar.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Collapsible variant starts EXPANDED on mount (the SerialCard remounts per
  // line, so opening a PO line always shows the full row for selection); it
  // collapses to the chosen pill once a grade is picked. The parent may take
  // control via `expanded`/`onExpandedChange` (e.g. collapse while editing a
  // serial); otherwise it's self-managed.
  const [internalExpanded, setInternalExpanded] = useState(true);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    onExpandedChange?.(next);
    if (expandedProp === undefined) setInternalExpanded(next);
  };
  // The row scroller remounts across collapse/expand, so `expanded` re-binds
  // the wheel listener to the fresh element.
  useHorizontalWheelScroll(scrollerRef, expanded);

  // Collapsed: only the selected pill + an edit pencil (mirrors the copy-chip).
  if (collapsible && !expanded && selectedGrade) {
    return (
      <div role="radiogroup" aria-label="Condition grade" className="flex w-fit items-center gap-1.5">
        <button
          type="button"
          aria-label={`Condition ${selectedGrade.label} — change`}
          onClick={() => setExpanded(true)}
          className={pillClass(selectedGrade.value, true)}
        >
          {selectedGrade.label}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Edit condition"
          className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      role="radiogroup"
      aria-label="Condition grade"
      className="-mx-1 flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {GRADES.map((g) => (
        <button
          key={g.value}
          type="button"
          role="radio"
          aria-checked={selected === g.value}
          onClick={() => {
            onChange(g.value);
            if (collapsible) setExpanded(false);
          }}
          className={pillClass(g.value, selected === g.value)}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}
