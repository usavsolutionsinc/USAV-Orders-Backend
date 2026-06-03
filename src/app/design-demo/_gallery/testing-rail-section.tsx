'use client';

/**
 * Testing recent rail — the forked, testing-specific recent rail.
 *
 * A prototype of the "YOU TESTED" sidebar rail with corrected selection
 * semantics. The production SidebarRailShell hoists any selected line to the
 * top (conflating "I'm viewing this" with "this was tested most recently").
 * Here selection only *highlights in place* — the list stays sorted by verdict
 * time, and a line rises to the top ONLY when its testing state actually
 * changes (a verdict is recorded). Matches the Gmail/Slack/Linear standard:
 * selection never reorders; data changes do.
 *
 * Two display variants for the off-window case:
 *   • inplace — highlight where it sits, never move it
 *   • pin     — a separate "NOW TESTING" slot above a strictly time-sorted feed
 *
 * Throwaway showroom code — self-contained, no data deps.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Check, Clock, RotateCcw, Wrench, Sparkles } from '@/components/Icons';
import { cx, type Density } from './sections';

type Verdict = 'PASS' | 'FAIL' | 'PARTS';

type TestLine = {
  id: number;
  title: string;
  tested: number;
  total: number;
  /** Minutes since this tester's most recent verdict. Smaller = newer = higher. */
  verdictMins: number;
  verdict: Verdict;
};

const SEED: TestLine[] = [
  { id: 1, title: 'Bose Wave Music System III', tested: 1, total: 1, verdictMins: 240, verdict: 'PASS' },
  { id: 2, title: 'Bose SoundTouch 10 Wireless Speaker, Black', tested: 2, total: 2, verdictMins: 245, verdict: 'PASS' },
  { id: 3, title: 'Bose SoundDock Series III Speaker w/ Cord', tested: 1, total: 1, verdictMins: 300, verdict: 'PASS' },
  { id: 4, title: 'Bose Wave Radio CD Player AWRC-1G — No Remote', tested: 1, total: 1, verdictMins: 360, verdict: 'FAIL' },
  { id: 5, title: 'Bose Wave Music System IV Espresso Black', tested: 1, total: 1, verdictMins: 1440, verdict: 'PASS' },
  { id: 6, title: 'Bose SoundLink III Portable Bluetooth, Silver', tested: 1, total: 1, verdictMins: 1500, verdict: 'PASS' },
  { id: 7, title: 'Bose TV Speaker Soundbar 431974 w/ Remote', tested: 1, total: 1, verdictMins: 4320, verdict: 'PARTS' },
  { id: 8, title: 'Bose Acoustimass 300 Powered Subwoofer', tested: 1, total: 1, verdictMins: 5760, verdict: 'PASS' },
];

function relTime(mins: number): string {
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = mins / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d`;
  return `${Math.round(d / 7)}w`;
}

const VERDICT_DOT: Record<Verdict, string> = {
  PASS: 'bg-emerald-500',
  FAIL: 'bg-rose-500',
  PARTS: 'bg-amber-500',
};
const VERDICT_TONE: Record<Verdict, string> = {
  PASS: 'text-emerald-600',
  FAIL: 'text-rose-600',
  PARTS: 'text-amber-600',
};

const rowPad: Record<Density, string> = {
  compact: 'py-1',
  cozy: 'py-1.5',
  comfortable: 'py-2.5',
};

const railSpring = { type: 'spring', stiffness: 460, damping: 38, mass: 0.7 } as const;

export function TestingRailSection({ density = 'cozy' as Density }: { density?: Density } = {}) {
  const [variant, setVariant] = useState<'inplace' | 'pin'>('inplace');
  /** The anti-pattern toggle: when on, selecting also hoists to top (today's bug). */
  const [hoistOnSelect, setHoistOnSelect] = useState(false);
  const [lines, setLines] = useState<TestLine[]>(SEED);
  const [selectedId, setSelectedId] = useState<number | null>(3);

  const sorted = useMemo(() => {
    const byVerdict = [...lines].sort((a, b) => a.verdictMins - b.verdictMins);
    if (hoistOnSelect && selectedId != null) {
      const i = byVerdict.findIndex((l) => l.id === selectedId);
      if (i > 0) {
        const [sel] = byVerdict.splice(i, 1);
        byVerdict.unshift(sel);
      }
    }
    return byVerdict;
  }, [lines, hoistOnSelect, selectedId]);

  const selected = lines.find((l) => l.id === selectedId) ?? null;

  // The feed actually rendered in RECENT. In the pin variant the now-testing
  // line lives in its own slot above, so drop it here — otherwise it shows
  // twice. Scanning the next line just re-points selectedId, so the previous
  // now-testing line stops being filtered and drops back into Recent at its
  // chronological spot. In highlight-in-place there's no pin, so nothing is
  // removed (the active line stays in the feed, highlighted).
  const feed = useMemo(
    () => (variant === 'pin' && selectedId != null ? sorted.filter((r) => r.id !== selectedId) : sorted),
    [sorted, variant, selectedId],
  );

  /** Simulate a state change: record a fresh verdict → line legitimately bumps. */
  const recordVerdict = (id: number, verdict: Verdict) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, verdictMins: 0, verdict } : l)));
  };

  const reset = () => {
    setLines(SEED);
    setSelectedId(3);
    setHoistOnSelect(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-xl bg-surface-canvas p-0.5 ring-1 ring-border-soft">
          {(['inplace', 'pin'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVariant(v)}
              className={cx(
                'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150',
                variant === v ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-default',
              )}
            >
              {v === 'inplace' ? 'Highlight in place' : 'Now-testing pin'}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-surface-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted ring-1 ring-border-soft">
          <input
            type="checkbox"
            checked={hoistOnSelect}
            onChange={(e) => setHoistOnSelect(e.target.checked)}
            className="h-3 w-3 accent-rose-500"
          />
          Hoist on select <span className="text-rose-500">(old bug)</span>
        </label>

        <button
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-surface-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted ring-1 ring-border-soft transition-colors hover:text-text-default"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* ── the rail ─────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-surface-card">
          {/* eyebrow */}
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-text-muted">
              Recent · {feed.length}
            </p>
            <p className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-widest text-text-muted/70">
              <Wrench className="h-2.5 w-2.5" /> You tested
            </p>
          </div>

          {/* now-testing pin (pin variant only) */}
          <AnimatePresence initial={false}>
            {variant === 'pin' && selected ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={railSpring}
                className="border-b border-blue-200 bg-blue-50/60"
              >
                <p className="px-3 pt-1.5 text-[8.5px] font-black uppercase tracking-widest text-blue-600">Now testing</p>
                <RailRow row={selected} selected density={density} pinned onClick={() => {}} onRecord={recordVerdict} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* the feed */}
          <LayoutGroup>
            <ul className="px-1.5 py-1">
              <AnimatePresence initial={false}>
                {feed.map((row) => (
                  <RailRow
                    key={row.id}
                    row={row}
                    density={density}
                    selected={row.id === selectedId}
                    onClick={() => setSelectedId(row.id)}
                    onRecord={recordVerdict}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </LayoutGroup>
        </div>

        {/* ── explainer ────────────────────────────────────────────────── */}
        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-dashed border-border-soft p-4 text-[12px] leading-relaxed text-text-muted">
          <p className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span>
              <span className="font-semibold text-text-default">Click a row</span> — it highlights where it sits. With the
              correct model it <span className="font-semibold text-text-default">does not jump</span> to the top; the feed
              stays sorted by verdict time.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span>
              <span className="font-semibold text-text-default">Hover a row → Pass / Fail</span> to record a verdict. Now
              the line legitimately bumps to the top (its <code className="font-mono text-[11px]">tested_at</code> changed).
              That's the only thing that should reorder it.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
            <span>
              Tick <span className="font-semibold text-rose-500">Hoist on select</span> to feel today's behavior: viewing a
              3-day-old line throws it above items tested 4 h ago — the bug you flagged.
            </span>
          </p>
          <div className="mt-1 rounded-xl bg-surface-canvas/70 p-3 text-[11px] ring-1 ring-border-soft/60">
            <p className="font-semibold text-text-default">Two off-window display options</p>
            <p className="mt-1">
              <span className="font-semibold text-text-default">Highlight in place</span> — never move it; rely on the
              workspace pane for the open line. <span className="font-semibold text-text-default">Now-testing pin</span> —
              the scanned line shows once, in its own slot, and is removed from the feed below (no duplicate). Scan the
              next line and the previous one drops into Recent at its real spot.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RailRow({
  row,
  selected,
  density,
  pinned = false,
  onClick,
  onRecord,
}: {
  row: TestLine;
  selected: boolean;
  density: Density;
  pinned?: boolean;
  onClick: () => void;
  onRecord: (id: number, verdict: Verdict) => void;
}) {
  const complete = row.tested >= row.total && row.total > 0;
  return (
    <motion.li
      layout={!pinned}
      layoutId={pinned ? undefined : `rail-${row.id}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={railSpring}
      className="group relative list-none"
    >
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'flex w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors',
          rowPad[density],
          selected
            ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-400'
            : 'hover:bg-surface-canvas',
        )}
      >
        <span className={cx('h-2 w-2 shrink-0 rounded-full', VERDICT_DOT[row.verdict])} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-bold text-text-default" title={row.title}>{row.title}</p>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">
            <span className={complete ? VERDICT_TONE[row.verdict] : 'text-text-muted'}>
              {row.tested}/{row.total}
            </span>
            <span className="ml-1 opacity-60">· {row.verdict}</span>
          </p>
        </div>

        {/* hover verdict actions — collapse to the timestamp when idle */}
        <span className="shrink-0 tabular-nums text-[10px] font-medium text-text-muted group-hover:hidden">
          {relTime(row.verdictMins)}
        </span>
        <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
          <VerdictBtn tone="emerald" label="Pass" onClick={(e) => { e.stopPropagation(); onRecord(row.id, 'PASS'); }} />
          <VerdictBtn tone="rose" label="Fail" onClick={(e) => { e.stopPropagation(); onRecord(row.id, 'FAIL'); }} />
        </span>
      </button>
    </motion.li>
  );
}

function VerdictBtn({
  tone,
  label,
  onClick,
}: {
  tone: 'emerald' | 'rose';
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const tones = {
    emerald: 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25',
    rose: 'bg-rose-500/15 text-rose-600 hover:bg-rose-500/25',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest transition-colors', tones[tone])}
    >
      {label}
    </button>
  );
}
