'use client';

import { useCallback, useRef, type WheelEvent, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
}

// Per-grade visual tone — selected = filled, unselected = soft outline.
const TONE: Record<string, { active: string; inactive: string }> = {
  BRAND_NEW: {
    active: 'bg-yellow-500 text-white shadow-sm shadow-yellow-200 ring-yellow-600',
    inactive: 'bg-white text-yellow-800 ring-yellow-200 hover:bg-yellow-50',
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

/**
 * Bare, mobile-first condition picker. Renders grades as a horizontally-scrolling
 * row of pills. "USED" options are nested: selecting USED expands sub-grades
 * (A, B, C) with a smooth animation.
 */
export function ConditionPills({ value, onChange }: Props) {
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

  return (
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

      {/* USED GROUP */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Pill
          label={isUsed && !isExpanded ? `USED ${usedGrade}` : 'USED'}
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
}
