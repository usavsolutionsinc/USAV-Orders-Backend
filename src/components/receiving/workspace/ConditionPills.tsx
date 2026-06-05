'use client';

import { useCallback, useRef, type WheelEvent, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
  /**
   * When set, once a grade is selected the picker collapses to show ONLY the
   * selected pill on the left; hovering that pill re-expands the full row.
   * With nothing selected the full row stays visible so a grade can be picked.
   */
  collapsible?: boolean;
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

const USED_GRADES = [
  { value: 'USED_A', label: 'A' },
  { value: 'USED_B', label: 'B' },
  { value: 'USED_C', label: 'C' },
];

// Label shown on the single collapsed pill, keyed by selected grade. Mirrors
// the pill labels in the full row so the collapsed chip reads identically.
const COLLAPSED_LABEL: Record<string, string> = {
  BRAND_NEW: 'NEW',
  LIKE_NEW: 'L-New',
  REFURBISHED: 'REFURB',
  USED_A: 'A',
  USED_B: 'B',
  USED_C: 'C',
  PARTS: 'PARTS',
};

/**
 * Bare, mobile-first condition picker. Renders grades as a horizontally-scrolling
 * row of pills. "USED" options are nested: selecting USED expands sub-grades
 * (A, B, C) with a smooth animation.
 */
export function ConditionPills({ value, onChange, collapsible = false }: Props) {
  const selected = String(value || '').trim().toUpperCase();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const isUsed = selected.startsWith('USED_');
  const usedGrade = isUsed ? selected.split('_')[1] : null;

  // Collapse if we switch away from USED via external props
  useEffect(() => {
    if (!isUsed) setIsExpanded(false);
  }, [isUsed]);

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, []);

  const handleUsedMainClick = () => {
    if (!isUsed) {
      onChange('USED_B');
      setIsExpanded(true);
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  const Pill = ({ 
    label, 
    isActive, 
    onClick, 
    toneKey, 
    className = '' 
  }: { 
    label: string; 
    isActive: boolean; 
    onClick: () => void; 
    toneKey: string;
    className?: string;
  }) => {
    const tone = TONE[toneKey] ?? TONE.USED_C;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={isActive}
        onClick={onClick}
        className={`inline-flex h-9 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-4 text-caption font-black uppercase tracking-[0.1em] ring-1 ring-inset transition-all active:scale-[0.98] ${
          isActive ? tone.active : tone.inactive
        } ${className}`}
      >
        {label}
      </button>
    );
  };

  const fullRow = (
    <div
      ref={scrollerRef}
      onWheel={onWheel}
      role="radiogroup"
      aria-label="Condition grade"
      className="-mx-1 flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* BRAND NEW */}
      <Pill
        label="NEW"
        isActive={selected === 'BRAND_NEW'}
        toneKey="BRAND_NEW"
        onClick={() => onChange('BRAND_NEW')}
      />

      {/* LIKE NEW */}
      <Pill
        label="L-New"
        isActive={selected === 'LIKE_NEW'}
        toneKey="LIKE_NEW"
        onClick={() => onChange('LIKE_NEW')}
      />

      {/* REFURBISHED */}
      <Pill
        label="REFURB"
        isActive={selected === 'REFURBISHED'}
        toneKey="REFURBISHED"
        onClick={() => onChange('REFURBISHED')}
      />

      {/* USED GROUP */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Pill
          label={isUsed && !isExpanded && usedGrade ? usedGrade : 'USED'}
          isActive={isUsed}
          toneKey={isUsed ? selected : 'USED_B'}
          onClick={handleUsedMainClick}
        />

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ width: 0, opacity: 0, x: -10 }}
              animate={{ width: 'auto', opacity: 1, x: 0 }}
              exit={{ width: 0, opacity: 0, x: -10 }}
              className="flex gap-1.5 overflow-hidden"
            >
              {USED_GRADES.map((g) => (
                <Pill
                  key={g.value}
                  label={g.label}
                  isActive={selected === g.value}
                  toneKey={g.value}
                  onClick={() => {
                    onChange(g.value);
                    setIsExpanded(false);
                  }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* PARTS */}
      <Pill
        label="PARTS"
        isActive={selected === 'PARTS'}
        toneKey="PARTS"
        onClick={() => onChange('PARTS')}
      />
    </div>
  );

  // Default: the full pill row is always shown.
  const collapsedLabel = COLLAPSED_LABEL[selected];
  if (!collapsible || !collapsedLabel) return fullRow;

  // Collapsed: show only the selected pill, so the row stays compact and the
  // serial input grows to fill the space. Hovering this spot expands the full
  // row IN FLOW (grid 0fr→1fr) — it pushes the input over rather than overlaying
  // it. Hover is scoped to this group, so only this exact spot re-expands.
  return (
    <div className="group/cond flex items-center">
      <div className="shrink-0 group-hover/cond:hidden">
        <Pill label={collapsedLabel} isActive toneKey={selected} onClick={() => {}} />
      </div>
      <div className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-500 ease-out group-hover/cond:grid-cols-[1fr]">
        <div className="overflow-hidden">{fullRow}</div>
      </div>
    </div>
  );
}
