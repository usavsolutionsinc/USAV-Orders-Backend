'use client';

import { Fragment, useCallback, useRef, type WheelEvent, useState, useEffect } from 'react';
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

// "NEW+" groups the non-used, retail-ready grades behind one parent pill that
// expands to its members — exactly like the USED group expands to A/B/C.
const NEW_GRADES = [
  { value: 'BRAND_NEW', label: 'NEW' },
  { value: 'LIKE_NEW', label: 'L-New' },
  { value: 'REFURBISHED', label: 'REFURB' },
];
const NEW_GROUP_VALUES = NEW_GRADES.map((g) => g.value);

// Spring that drives the inline slide-out width — mirrors the design-demo
// variant C (condition-picker-section.tsx) that this collapse is modeled on.
const SLIDE_SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/**
 * Bare, mobile-first condition picker. Renders grades as a horizontally-scrolling
 * row of pills. "USED" options are nested: selecting USED expands sub-grades
 * (A, B, C) with a smooth animation.
 */
export function ConditionPills({ value, onChange, collapsible = false }: Props) {
  const selected = String(value || '').trim().toUpperCase();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Collapsible (line-edit) variant: is the inline slide-out open?
  const [collapsedOpen, setCollapsedOpen] = useState(false);

  const isUsed = selected.startsWith('USED_');
  const usedGrade = isUsed ? selected.split('_')[1] : null;

  const isNewGroup = NEW_GROUP_VALUES.includes(selected);
  const newGradeLabel = NEW_GRADES.find((g) => g.value === selected)?.label ?? null;
  const [isNewExpanded, setIsNewExpanded] = useState(false);

  // Collapse if we switch away from USED via external props
  useEffect(() => {
    if (!isUsed) setIsExpanded(false);
  }, [isUsed]);

  // Same for the NEW+ group.
  useEffect(() => {
    if (!isNewGroup) setIsNewExpanded(false);
  }, [isNewGroup]);

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

  const handleNewMainClick = () => {
    if (!isNewGroup) {
      onChange('BRAND_NEW');
      setIsNewExpanded(true);
    } else {
      setIsNewExpanded(!isNewExpanded);
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

  // ── The three top-level groups, each its own element so they can be reused
  //    by both the always-on full row and the collapsible per-group reveal. ──
  const newGroup = (
    <div className="flex shrink-0 items-center gap-1.5">
      {/* The NEW+ parent hides while expanded — its members replace it. (USED
          keeps its parent because the bare A/B/C grades need the "USED" label;
          NEW / L-New / REFURB are self-explanatory, so "NEW+" is redundant.) */}
      {!isNewExpanded && (
        <Pill
          label={isNewGroup && newGradeLabel ? newGradeLabel : 'NEW+'}
          isActive={isNewGroup}
          toneKey={isNewGroup ? selected : 'BRAND_NEW'}
          onClick={handleNewMainClick}
        />
      )}
      <AnimatePresence initial={false}>
        {isNewExpanded && (
          <motion.div
            initial={{ width: 0, opacity: 0, x: -10 }}
            animate={{ width: 'auto', opacity: 1, x: 0 }}
            exit={{ width: 0, opacity: 0, x: -10 }}
            className="flex gap-1.5 overflow-hidden"
          >
            {NEW_GRADES.map((g) => (
              <Pill
                key={g.value}
                label={g.label}
                isActive={selected === g.value}
                toneKey={g.value}
                onClick={() => {
                  onChange(g.value);
                  setIsNewExpanded(false);
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const usedGroup = (
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
  );

  const partsPill = (
    <Pill label="PARTS" isActive={selected === 'PARTS'} toneKey="PARTS" onClick={() => onChange('PARTS')} />
  );

  const fullRow = (
    <div
      ref={scrollerRef}
      onWheel={onWheel}
      role="radiogroup"
      aria-label="Condition grade"
      className="-mx-1 flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {newGroup}
      {usedGroup}
      {partsPill}
    </div>
  );

  // Default (non-collapsible) and "no grade picked yet": show the full row so a
  // grade can be chosen.
  const selectedGroup = isNewGroup ? 'NEW' : isUsed ? 'USED' : selected === 'PARTS' ? 'PARTS' : null;
  if (!collapsible || !selectedGroup) return fullRow;

  // Collapsible (line-edit) variant: the SELECTED group's pill is pinned at the
  // far left and always mounted (so the row collapses to e.g. "B"); hovering it
  // springs a hairline + the OTHER two groups out to its right. One width-spring
  // drives the whole reveal and the pinned pill never unmounts, so open/close
  // stay smooth — no display swap, no grid-track animation.
  const groupEl = { NEW: newGroup, USED: usedGroup, PARTS: partsPill };
  const others = (['NEW', 'USED', 'PARTS'] as const).filter((k) => k !== selectedGroup);

  return (
    <div
      role="radiogroup"
      aria-label="Condition grade"
      className="flex w-fit items-center gap-1.5"
      onPointerEnter={() => setCollapsedOpen(true)}
      onPointerLeave={() => {
        // Collapse back to just the selected pill — also fold any open sub-grade
        // expansion so it returns to e.g. "NEW" rather than the members.
        setCollapsedOpen(false);
        setIsNewExpanded(false);
        setIsExpanded(false);
      }}
    >
      {groupEl[selectedGroup]}
      <AnimatePresence initial={false}>
        {collapsedOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SLIDE_SPRING}
            className="flex items-center gap-1.5 overflow-hidden"
          >
            {/* Hairline between the pinned selected pill and the rest. */}
            <span aria-hidden className="h-7 w-px shrink-0 bg-gray-200" />
            {others.map((k) => (
              <Fragment key={k}>{groupEl[k]}</Fragment>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
