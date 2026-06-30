'use client';

import { ReactNode, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { DateRange } from 'react-day-picker';
import {
  PaneHeader,
  PaneHeaderTitle,
} from './pane-header';
import { Calendar } from '@/design-system/components/Calendar';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { formatWeekRangeCompact } from '@/utils/date';
import { cn } from '@/utils/_cn';

interface WeekRange {
  startStr: string;
  endStr: string;
}

/** A one-tap period in the picker popover (e.g. "This week", "Last month"). */
export interface DateRangePreset {
  label: string;
  onSelect: () => void;
  active?: boolean;
}

/* ── YYYY-MM-DD ⇄ Date helpers (local frame, matches the week/month ranges) ── */
const parseKey = (k?: string | null): Date | undefined => {
  if (!k) return undefined;
  const [y, m, d] = k.split('-').map(Number);
  return Number.isFinite(y) ? new Date(y, (m || 1) - 1, d || 1) : undefined;
};
const fmtKey = (d?: Date): string =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

interface DateRangePickerPillProps {
  /** Text shown on the pill (e.g. "JUN 23rd – 27th"). */
  label: ReactNode;
  /** Right-detail count appended after a dot ("… • 29"). */
  count?: number;
  /** Preset rows (This week / Last week / This month …). */
  presets?: DateRangePreset[];
  /** Enables a calendar + Apply for an arbitrary range. */
  onSelectCustomRange?: (range: WeekRange) => void;
  /** Active explicit range — seeds the calendar's open month + selection. */
  activeRange?: WeekRange | null;
  /** Reset affordance (e.g. back to the current week); shown when set. */
  onClear?: () => void;
  /** Prev/next week stepping — rendered as a compact row in the popover. */
  weekNav?: { weekOffset: number; onPrev: () => void; onNext: () => void };
  className?: string;
}

/**
 * The pill date+filter picker — a single rounded "{label} • {count}" pill that
 * opens a popover of period presets (week / month), an optional calendar for a
 * custom range, and optional prev/next week stepping. This is the interactive
 * core shared by {@link DateRangeHeader} (table headers) and the board header.
 *
 * It owns no application state: every choice flows out through `presets` /
 * `onSelectCustomRange` / `weekNav` so each surface maps a selection onto its
 * own URL params (the shipped table writes `?shippedWeekOffset` / `?dateFrom`).
 */
export function DateRangePickerPill({
  label,
  count,
  presets,
  onSelectCustomRange,
  activeRange,
  onClear,
  weekNav,
  className,
}: DateRangePickerPillProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const hasPicker = Boolean((presets && presets.length) || onSelectCustomRange || weekNav);

  const pill = (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 transition-colors',
        hasPicker
          ? 'cursor-pointer border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
          : 'border-transparent',
        className,
      )}
    >
      <span className="text-caption font-black uppercase tracking-widest text-gray-900">{label}</span>
      {count != null ? (
        <>
          <span aria-hidden className="text-gray-300">•</span>
          <span className="text-caption font-bold tabular-nums text-gray-500">{count}</span>
        </>
      ) : null}
    </span>
  );

  // No picker affordances → a static, non-interactive pill (e.g. a fixed range).
  if (!hasPicker) return pill;

  const onOpenChange = (next: boolean) => {
    if (next) setDraft(activeRange?.startStr ? { from: parseKey(activeRange.startStr), to: parseKey(activeRange.endStr) } : undefined);
    setOpen(next);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        {/* ds-raw-button: pill trigger wraps a styled span; not a DS Button shape */}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="date-range-pill"
          className="-my-0.5 inline-flex"
        >
          {pill}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-dropdown w-auto rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          {presets && presets.length ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 p-2">
              {presets.map((p) => (
                // ds-raw-button: two-state preset chip (active blue fill), not a DS variant
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    p.onSelect();
                    setOpen(false);
                  }}
                  className={cn(
                    'rounded-md px-2 py-1 text-eyebrow font-black uppercase tracking-wider transition-colors',
                    p.active
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          {weekNav ? (
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-1.5">
              {/* ds-raw-button: compact step control, icon-only, inside the popover */}
              <button
                type="button"
                onClick={weekNav.onPrev}
                aria-label="Previous week"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Step week</span>
              {/* ds-raw-button: compact step control, icon-only, inside the popover */}
              <button
                type="button"
                onClick={weekNav.onNext}
                disabled={weekNav.weekOffset === 0}
                aria-label="Next week"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {onSelectCustomRange ? (
            <>
              <Calendar
                mode="range"
                selected={draft}
                onSelect={setDraft}
                numberOfMonths={1}
                defaultMonth={draft?.from ?? parseKey(activeRange?.startStr) ?? new Date()}
              />
              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                {/* ds-raw-button: text link footer action (no chrome) */}
                <button
                  type="button"
                  onClick={() => {
                    onClear?.();
                    setOpen(false);
                  }}
                  className="text-eyebrow font-black uppercase tracking-wider text-slate-500 hover:text-slate-900"
                >
                  {onClear ? 'Reset' : 'Cancel'}
                </button>
                {/* ds-raw-button: primary apply pill scoped to the popover */}
                <button
                  type="button"
                  disabled={!draft?.from}
                  onClick={() => {
                    if (!draft?.from) return;
                    onSelectCustomRange({ startStr: fmtKey(draft.from), endStr: fmtKey(draft.to ?? draft.from) });
                    setOpen(false);
                  }}
                  className="rounded-md bg-blue-600 px-3 py-1 text-caption font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Apply
                </button>
              </div>
            </>
          ) : onClear ? (
            <div className="flex items-center justify-end border-t border-gray-100 px-3 py-2">
              {/* ds-raw-button: text link footer action (no chrome) */}
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="text-eyebrow font-black uppercase tracking-wider text-slate-500 hover:text-slate-900"
              >
                Reset to this week
              </button>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface DateRangeHeaderProps {
  /** Period total — rendered as the pill's right-detail ("… • {count}"). */
  count: number;
  /** Optional left title (e.g. "Today"). */
  label?: ReactNode;
  /** Far-left extra content (rare). */
  leftSlot?: ReactNode;
  /** Right-side surface content (search chip, refresh spinner, close button). */
  rightSlot?: ReactNode;
  /** Top-right chrome — the columns icon lives here (always last on the right). */
  columns?: ReactNode;
  /** Week range backing the pill label; omit for a plain count (no pill). */
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  /** Period presets (This week / month …) — enables the rich picker. */
  presets?: DateRangePreset[];
  /** Custom range via calendar — enables the rich picker. */
  onSelectCustomRange?: (range: WeekRange) => void;
  /** Active explicit (non-week) range — overrides the pill label + seeds the calendar. */
  activeRange?: WeekRange | null;
  /** Reset to the default week. */
  onClear?: () => void;
}

/**
 * Slim 40px table header: a single pill date+filter picker on the left
 * ("{range} • {count}") and the columns icon pinned top-right. Replaces the old
 * WeekHeader — instead of count-left + prev/next-chevrons-right, the pill opens
 * a popover to pick a week, a month, or a custom range.
 *
 * Surfaces with only week stepping pass `weekRange` + `onPrevWeek`/`onNextWeek`
 * (the popover shows a Step-week row). The shipped surface additionally passes
 * `presets` + `onSelectCustomRange` + `activeRange` for the full week/month/
 * custom picker. A surface with no `weekRange` (e.g. Repair) renders a plain
 * count with no picker.
 */
export default function DateRangeHeader({
  count,
  label,
  leftSlot,
  rightSlot,
  columns,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  presets,
  onSelectCustomRange,
  activeRange,
  onClear,
}: DateRangeHeaderProps) {
  // Pill label: an active explicit range wins, else the week range; if neither,
  // there's no pill and we fall back to a bare count.
  const pillRange = activeRange ?? weekRange ?? null;
  const pillLabel = pillRange ? formatWeekRangeCompact(pillRange.startStr, pillRange.endStr) : null;
  const weekNav =
    weekRange && onPrevWeek && onNextWeek ? { weekOffset, onPrev: onPrevWeek, onNext: onNextWeek } : undefined;

  return (
    <PaneHeader
      // Inner gray-300 row divider (matches sidebar + day-group bands), not the
      // faint outer border on the translucent sticky shell.
      className="border-b-0"
      rowClassName="border-b border-gray-300"
      leftSlot={
        <>
          {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
          {label ? <PaneHeaderTitle>{label}</PaneHeaderTitle> : null}
          {pillLabel != null ? (
            <DateRangePickerPill
              label={pillLabel}
              count={count}
              presets={presets}
              onSelectCustomRange={onSelectCustomRange}
              activeRange={activeRange}
              onClear={onClear}
              weekNav={weekNav}
            />
          ) : (
            <span className="font-dm-sans text-sm font-semibold tabular-nums text-blue-700">{count}</span>
          )}
        </>
      }
      rightSlot={
        rightSlot || columns ? (
          <div className="flex items-center gap-1.5">
            {rightSlot}
            {columns}
          </div>
        ) : null
      }
    />
  );
}
