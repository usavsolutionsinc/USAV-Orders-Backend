'use client';

/**
 * Condition picker — condensing the PO-items grade selector into one row.
 *
 * Today the picker renders the full grade set as a horizontal row of pills, so
 * the line-edit panel always shows six options the user isn't choosing. This
 * section walks through ways to make it *contextual*: keep the current grade on
 * the left and reveal the rest only on demand.
 *
 * Every variant is rendered inside a mock of the real "PO ITEMS · 1" line card
 * (title + meta row + serial field) so you can judge each in context and
 * cherry-pick. Self-contained showroom code — nothing here is wired into the
 * app, and it does not import the production ConditionPills.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronRight } from '@/components/Icons';
import { cx, type Density } from './sections';

/* ────────────────────────────── grade model ─────────────────────────────── */

// Per-grade visual tone — mirrors the production pill palette so the variants
// read true-to-life. selected = filled, unselected = soft outline.
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

const DOT: Record<string, string> = {
  BRAND_NEW: 'bg-yellow-500',
  LIKE_NEW: 'bg-teal-600',
  REFURBISHED: 'bg-indigo-600',
  USED_A: 'bg-emerald-600',
  USED_B: 'bg-blue-600',
  USED_C: 'bg-slate-700',
  PARTS: 'bg-amber-700',
};

type Grade = { value: string; label: string };

// Flat grade list — USED split into explicit A/B/C so the whole condition space
// lives in one menu (no nested expand step).
const GRADES: Grade[] = [
  { value: 'BRAND_NEW', label: 'NEW' },
  { value: 'LIKE_NEW', label: 'LIKE NEW' },
  { value: 'REFURBISHED', label: 'REFURB' },
  { value: 'USED_A', label: 'USED · A' },
  { value: 'USED_B', label: 'USED · B' },
  { value: 'USED_C', label: 'USED · C' },
  { value: 'PARTS', label: 'PARTS' },
];

const gradeOf = (value: string) => GRADES.find((g) => g.value === value) ?? GRADES[3];

const POP_SPRING = { type: 'spring', stiffness: 460, damping: 32 } as const;
const SLIDE_SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/* ───────────────────────────── shared furniture ─────────────────────────── */

function DemoTag({ kind }: { kind: 'new' | 'have' | 'upgrade' }) {
  const map = {
    new: ['bg-emerald-500/12 text-emerald-600 ring-emerald-500/20', '2026 · New'],
    upgrade: ['bg-violet-500/12 text-violet-600 ring-violet-500/20', '2026 · Upgrade'],
    have: ['bg-slate-500/10 text-text-muted ring-border-soft', 'In system'],
  } as const;
  const [clsName, label] = map[kind];
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1', clsName)}>
      {label}
    </span>
  );
}

function VariantCard({
  title,
  promote,
  tag,
  caption,
  children,
}: {
  title: string;
  promote: string;
  tag: 'new' | 'have' | 'upgrade';
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">{title}</h3>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">{promote}</code>
        </div>
        <DemoTag kind={tag} />
      </div>
      <div className="flex flex-1 items-start justify-center rounded-xl bg-surface-canvas/60 p-5 ring-1 ring-border-soft/60">
        {children}
      </div>
      <p className="mt-2.5 text-[11px] leading-snug text-text-muted">{caption}</p>
    </div>
  );
}

const serialPad: Record<Density, string> = {
  compact: 'py-1.5',
  cozy: 'py-2',
  comfortable: 'py-2.5',
};

/** Mock of the real "PO ITEMS · 1" line card so each picker is judged in context. */
function LineShell({ children, density }: { children: React.ReactNode; density: Density }) {
  return (
    <div className="w-full max-w-[420px]">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">PO Items · 1</p>
      <div className="rounded-2xl border border-blue-400/50 bg-surface-card p-3.5 ring-1 ring-blue-500/10">
        <div className="flex items-start gap-2">
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold leading-tight text-text-default">
              Bose Wave Music System IV CD Player AM/FM Radio
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] font-semibold text-text-muted">
              <span className="text-emerald-600">1/1</span>
              <span className="text-text-muted/40">·</span>
              <span className="border-b-2 border-amber-400 pb-px font-mono font-bold text-text-default">6-SV</span>
              <span className="text-text-muted/40">·</span>
              <span className="border-b-2 border-emerald-500 pb-px font-mono font-bold text-text-default">48AE</span>
            </div>
          </div>
        </div>

        {/* condition slot */}
        <div className="mt-3 border-t border-border-soft/70 pt-3">{children}</div>

        <input
          readOnly
          placeholder="Serial"
          className={cx(
            'mt-3 w-full rounded-xl border border-border-soft bg-surface-canvas/60 px-3 text-[13px] text-text-muted outline-none placeholder:text-text-muted/70',
            serialPad[density],
          )}
        />
      </div>
    </div>
  );
}

/** Dismiss on Escape / outside-click while a reveal is open. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close, ref]);
}

function GradePill({
  label,
  active,
  toneKey,
  onClick,
  size = 'md',
}: {
  label: string;
  active: boolean;
  toneKey: string;
  onClick: () => void;
  size?: 'sm' | 'md';
}) {
  const tone = TONE[toneKey] ?? TONE.USED_C;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-black uppercase tracking-[0.08em] ring-1 ring-inset transition-all active:scale-[0.97]',
        size === 'sm' ? 'h-7 px-3 text-[10px]' : 'h-8 px-3.5 text-[11px]',
        active ? tone.active : tone.inactive,
      )}
    >
      {label}
    </button>
  );
}

function RevealArrow({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="true"
      aria-expanded={open}
      aria-label="Change condition"
      onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted ring-1 ring-inset ring-border-soft transition-colors hover:bg-surface-card hover:text-text-default"
    >
      <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} className="flex">
        <ChevronRight className="h-4 w-4" />
      </motion.span>
    </button>
  );
}

/* ──────────────────────────────── variants ──────────────────────────────── */

/** A · Today — the full row of pills (the thing we're condensing). */
function FullRowPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="-mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {GRADES.map((g) => (
        <GradePill key={g.value} label={g.label} active={value === g.value} toneKey={g.value} onClick={() => onChange(g.value)} />
      ))}
    </div>
  );
}

/** B · Selected pill + arrow → hover/click reveals the full menu in a popover. */
function PopoverPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const current = gradeOf(value);

  useDismiss(open, () => setOpen(false), ref);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const cancelClose = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    timer.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <div
      ref={ref}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      className="relative flex w-fit items-center gap-1.5"
    >
      <GradePill label={current.label} active toneKey={current.value} onClick={() => setOpen((v) => !v)} />
      <RevealArrow open={open} onClick={() => setOpen((v) => !v)} />

      <AnimatePresence>
        {open && (
          <motion.div
            role="radiogroup"
            aria-label="Condition grade"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={POP_SPRING}
            style={{ transformOrigin: 'top left' }}
            className="absolute left-0 top-full z-30 mt-2 flex w-max max-w-[300px] flex-wrap gap-1.5 rounded-2xl border border-border-soft bg-surface-card p-2 shadow-xl shadow-slate-900/10"
          >
            {GRADES.map((g) => (
              <GradePill
                key={g.value}
                label={g.label}
                active={value === g.value}
                toneKey={g.value}
                onClick={() => {
                  onChange(g.value);
                  setOpen(false);
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** C · Selected pill + arrow → the other grades slide out inline to the right. */
function InlineSlidePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = gradeOf(value);
  const others = GRADES.filter((g) => g.value !== current.value);

  useDismiss(open, () => setOpen(false), ref);

  return (
    <div ref={ref} className="flex w-full items-center gap-1.5">
      <GradePill label={current.label} active toneKey={current.value} onClick={() => setOpen((v) => !v)} />
      <RevealArrow open={open} onClick={() => setOpen((v) => !v)} />

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SLIDE_SPRING}
            className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {others.map((g) => (
              <GradePill
                key={g.value}
                label={g.label}
                active={false}
                toneKey={g.value}
                size="sm"
                onClick={() => {
                  onChange(g.value);
                  setOpen(false);
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** D · Ultra-condensed select chip → caret opens a vertical dropdown menu. */
function DropdownPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = gradeOf(value);
  const tone = TONE[current.value] ?? TONE.USED_C;

  useDismiss(open, () => setOpen(false), ref);

  return (
    <div ref={ref} className="relative w-fit">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-full pl-3.5 pr-2 text-[11px] font-black uppercase tracking-[0.08em] ring-1 ring-inset transition-all active:scale-[0.97]',
          tone.active,
        )}
      >
        {current.label}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} className="flex">
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={POP_SPRING}
            style={{ transformOrigin: 'top left' }}
            className="absolute left-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border border-border-soft bg-surface-card p-1 shadow-xl shadow-slate-900/10"
          >
            {GRADES.map((g) => {
              const on = g.value === current.value;
              return (
                <li key={g.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      onChange(g.value);
                      setOpen(false);
                    }}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-bold uppercase tracking-wide transition-colors',
                      on ? 'bg-surface-canvas text-text-default' : 'text-text-muted hover:bg-surface-canvas/70 hover:text-text-default',
                    )}
                  >
                    <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', DOT[g.value])} />
                    <span className="flex-1">{g.label}</span>
                    {on && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ──────────────────────────────── section ───────────────────────────────── */

export function ConditionPickerSection({ density }: { density: Density }) {
  const [a, setA] = useState('USED_A');
  const [b, setB] = useState('USED_A');
  const [c, setC] = useState('USED_A');
  const [d, setD] = useState('USED_A');

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <VariantCard
        title="A · Today — full row"
        promote="@/components/receiving/workspace/ConditionPills"
        tag="have"
        caption="The current picker. Every grade is always on screen, so the line shows six options the user isn't choosing and the row scrolls sideways on narrow panels."
      >
        <LineShell density={density}>
          <FullRowPicker value={a} onChange={setA} />
        </LineShell>
      </VariantCard>

      <VariantCard
        title="B · Selected + arrow → popover"
        promote="@/components/receiving/workspace/ConditionPills"
        tag="upgrade"
        caption="Collapsed to the current grade + a reveal arrow. Hover (or click/focus) the arrow and the full menu pops; pick one and it collapses. Most contextual — one tidy chip until you need to change it."
      >
        <LineShell density={density}>
          <PopoverPicker value={b} onChange={setB} />
        </LineShell>
      </VariantCard>

      <VariantCard
        title="C · Inline slide-out"
        promote="@/components/receiving/workspace/ConditionPills"
        tag="new"
        caption="Same collapsed chip, but the alternatives spring out inline to the right and scroll — stays strictly one row, never overlays the serial field below."
      >
        <LineShell density={density}>
          <InlineSlidePicker value={c} onChange={setC} />
        </LineShell>
      </VariantCard>

      <VariantCard
        title="D · Select dropdown"
        promote="@/components/receiving/workspace/ConditionPills"
        tag="new"
        caption="The most condensed: a single colored chip with a caret opening a classic vertical menu (color dot + check). Smallest footprint, familiar select pattern."
      >
        <LineShell density={density}>
          <DropdownPicker value={d} onChange={setD} />
        </LineShell>
      </VariantCard>
    </div>
  );
}
