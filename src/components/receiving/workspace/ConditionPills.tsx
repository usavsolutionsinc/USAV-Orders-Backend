'use client';

import { CONDITION_OPTS } from '@/components/station/receiving-constants';

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
}

// Per-grade visual tone — selected = filled, unselected = soft outline.
// Yellow for new (factory-fresh), green for top used, blue for solid used,
// gray for cosmetic-only, amber for parts-only — same semantics as the
// existing CONDITION_OPTS but with deliberate hierarchy by tone.
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

/**
 * Big-tap condition picker: all 5 grades visible as ring-bordered pills, one
 * tap to set. Replaces the dropdown UX that was buried inside the Item
 * FlowSection — promotes condition to a top-of-workspace critical input.
 */
export function ConditionPills({ value, onChange }: Props) {
  const selected = String(value || '').trim().toUpperCase();
  const hasSelection = selected !== '' && selected !== 'PENDING';

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">
          Condition
        </h3>
        {!hasSelection ? (
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Select a grade
          </span>
        ) : null}
      </div>
      <div role="radiogroup" aria-label="Condition grade" className="flex flex-wrap gap-2">
        {CONDITION_OPTS.map((opt) => {
          const isActive = selected === opt.value;
          const tone = TONE[opt.value] ?? TONE.USED_C;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={`inline-flex h-11 flex-1 min-w-[88px] items-center justify-center rounded-xl px-4 text-[12px] font-black uppercase tracking-[0.1em] ring-1 ring-inset transition-all active:scale-[0.98] ${
                isActive ? tone.active : tone.inactive
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
