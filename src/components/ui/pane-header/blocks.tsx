'use client';

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from '../../Icons';
import { cn } from '@/utils/_cn';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// ─── PaneHeaderLabel ────────────────────────────────────────────────────────
// Small uppercase eyebrow over a bold value — the "PO · LINE 1 OF 2" /
// "381390806373" shape used in detail panes.

interface PaneHeaderLabelProps {
  /** Small uppercase tracking line (e.g. "PO · LINE 1 OF 2"). */
  eyebrow?: ReactNode;
  /** Bold value (e.g. an identifier, SKU, tracking number). */
  value: ReactNode;
  valueTitle?: string;
  valueClassName?: string;
  eyebrowClassName?: string;
}

export const paneHeaderLabelEyebrowClass =
  'text-[9px] font-black uppercase tracking-widest text-gray-400';

export const paneHeaderLabelValueClass =
  'truncate text-[14px] font-black tracking-tight text-gray-900';

export function PaneHeaderLabel({
  eyebrow,
  value,
  valueTitle,
  valueClassName = paneHeaderLabelValueClass,
  eyebrowClassName = paneHeaderLabelEyebrowClass,
}: PaneHeaderLabelProps) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      {eyebrow ? <span className={eyebrowClassName}>{eyebrow}</span> : null}
      <span className={valueClassName} title={valueTitle}>
        {value}
      </span>
    </div>
  );
}

// ─── PaneHeaderTitle ────────────────────────────────────────────────────────
// Single bold title — matches the WeekHeader "today" / sticky-date display.

export const paneHeaderHighContrastTitleClass =
  'text-sm font-black uppercase tracking-widest text-gray-900';

interface PaneHeaderTitleProps {
  children: ReactNode;
  className?: string;
}

export function PaneHeaderTitle({ children, className }: PaneHeaderTitleProps) {
  return (
    <p className={cn('min-w-0 truncate', paneHeaderHighContrastTitleClass, className)}>
      {children}
    </p>
  );
}

// ─── PaneHeaderCount ────────────────────────────────────────────────────────
// Tabular blue count — same look as WeekHeader's count badge.

interface PaneHeaderCountProps {
  count: number;
  className?: string;
}

export function PaneHeaderCount({ count, className }: PaneHeaderCountProps) {
  return (
    <p className={cn('shrink-0 font-dm-sans text-sm font-semibold tabular-nums text-blue-700', className)}>
      {count}
    </p>
  );
}

// ─── PaneHeaderIconBadge ────────────────────────────────────────────────────
// Rounded square icon badge (e.g. the blue pin in the receiving header).

interface PaneHeaderIconBadgeProps {
  Icon: IconComponent;
  /** Background tone class — e.g. `bg-blue-50`, `bg-rose-50`. */
  bg?: string;
  /** Foreground/icon tone class — e.g. `text-blue-600`. */
  tint?: string;
  size?: 'sm' | 'md';
  /** Corner rounding — defaults to `xl` (matches receiving header); use `lg` for the tighter tech-station look. */
  rounded?: 'lg' | 'xl';
  className?: string;
}

export function PaneHeaderIconBadge({
  Icon,
  bg = 'bg-blue-50',
  tint = 'text-blue-600',
  size = 'md',
  rounded = 'xl',
  className,
}: PaneHeaderIconBadgeProps) {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const radius = rounded === 'lg' ? 'rounded-lg' : 'rounded-xl';
  return (
    <span className={cn('flex shrink-0 items-center justify-center', box, radius, bg, tint, className)}>
      <Icon className={icon} />
    </span>
  );
}

// ─── PaneHeaderCloseButton ──────────────────────────────────────────────────
// Standard close (X) button — top-right corner of a detail pane.

interface PaneHeaderCloseButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  title?: string;
  className?: string;
}

export function PaneHeaderCloseButton({
  onClick,
  ariaLabel = 'Close',
  title = 'Close',
  className,
}: PaneHeaderCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95',
        className,
      )}
    >
      <X className="h-4 w-4" />
    </button>
  );
}

// ─── PaneHeaderStatusPill ───────────────────────────────────────────────────
// Small status pill — sits inline next to the label/value to call out current
// state. Matches the Plain / Pylon / ops-dashboard pattern surfaced by 2026
// research (status as headline, not as right-meta sidebar like Linear).

type StatusTone = 'neutral' | 'blue' | 'emerald' | 'amber' | 'yellow' | 'rose' | 'red' | 'purple';

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
};

interface PaneHeaderStatusPillProps {
  children: ReactNode;
  tone?: StatusTone;
  /** Adds a pulsing dot on the left — use sparingly for "live"/"active" states. */
  pulse?: boolean;
  className?: string;
}

export function PaneHeaderStatusPill({
  children,
  tone = 'neutral',
  pulse,
  className,
}: PaneHeaderStatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ring-1 ring-inset',
        STATUS_TONE_CLASS[tone],
        className,
      )}
    >
      {pulse ? (
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 animate-pulse rounded-full',
            tone === 'emerald' && 'bg-emerald-500',
            tone === 'blue' && 'bg-blue-500',
            tone === 'amber' && 'bg-amber-500',
            tone === 'yellow' && 'bg-yellow-400',
            tone === 'rose' && 'bg-rose-500',
            tone === 'red' && 'bg-red-500',
            tone === 'purple' && 'bg-purple-500',
            tone === 'neutral' && 'bg-slate-500',
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

// ─── PaneHeaderTabs ─────────────────────────────────────────────────────────
// Segmented tab strip for the secondary row beneath the identity header — the
// dual-sticky pattern that Vercel/Front/operations dashboards converge on for
// detail panes with 3+ sub-views (e.g. Lines / Receiving / Audit / Photos).
// Render inside `PaneHeader`'s `belowSlot`.

interface PaneHeaderTab<TValue extends string> {
  value: TValue;
  label: ReactNode;
  count?: number;
}

interface PaneHeaderTabsProps<TValue extends string> {
  tabs: Array<PaneHeaderTab<TValue>>;
  value: TValue;
  onChange: (next: TValue) => void;
  className?: string;
}

export function PaneHeaderTabs<TValue extends string>({
  tabs,
  value,
  onChange,
  className,
}: PaneHeaderTabsProps<TValue>) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-1 bg-white px-2 py-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              active
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <span>{tab.label}</span>
            {tab.count != null ? (
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-white/70' : 'text-gray-400',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ─── PaneHeaderActionBar ────────────────────────────────────────────────────
// Horizontal utility toolbar — icon+label action buttons on the left, optional
// status indicator, optional prev/next chevrons on the right. The shape
// originated in `LineEditPanel`'s in-body toolbar (Refresh / Share / Audit /
// Copy + ↑ ↓) and has become the canonical action surface for detail panes.
// Use inside a PaneHeader's belowSlot or at the top of a panel body.

export interface PaneHeaderActionBarAction {
  key: string;
  label: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Optional tone applied as a wrapper class around the icon — e.g. `'text-blue-600'`. */
  toneClassName?: string;
  /** Override the rendered title attribute. Defaults to `label`. */
  title?: string;
  /** Override the rendered aria-label. Defaults to `label`. */
  ariaLabel?: string;
}

interface PaneHeaderActionBarProps {
  actions: PaneHeaderActionBarAction[];
  /** Optional aria-live status text (e.g. "Syncing", "Saving"). */
  status?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevTitle?: string;
  nextTitle?: string;
  /** Card = rounded pill with subtle border + shadow. Flat = no chrome. */
  variant?: 'card' | 'flat';
  /** Icon-only mode — hides text labels but preserves them as aria-label/title for accessibility. */
  iconOnly?: boolean;
  className?: string;
}

const PANE_HEADER_ACTION_BTN_CLASS =
  'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40';

const PANE_HEADER_ACTION_NAV_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40';

export function PaneHeaderActionBar({
  actions,
  status,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  prevTitle = 'Previous',
  nextTitle = 'Next',
  variant = 'card',
  iconOnly = false,
  className,
}: PaneHeaderActionBarProps) {
  const shell =
    variant === 'card'
      ? 'flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white px-3 py-1.5 shadow-sm'
      : 'flex items-center gap-2 px-2 py-1.5';

  const renderText = (value: ReactNode): string | undefined =>
    typeof value === 'string' ? value : undefined;

  return (
    <div className={cn(shell, className)}>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.ariaLabel ?? renderText(action.label) ?? action.key}
          title={action.title ?? renderText(action.label) ?? action.key}
          className={cn(
            PANE_HEADER_ACTION_BTN_CLASS,
            iconOnly && 'h-7 w-7 justify-center gap-0 px-0',
          )}
        >
          <span className={cn('inline-flex items-center', action.toneClassName)}>{action.icon}</span>
          {iconOnly ? null : action.label}
        </button>
      ))}
      {status != null ? (
        <span
          className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-600"
          aria-live="polite"
        >
          {status}
        </span>
      ) : null}
      {(onPrev || onNext) && <div className="flex-1" />}
      {onPrev ? (
        <button
          type="button"
          onClick={onPrev}
          disabled={prevDisabled}
          aria-label={prevTitle}
          title={prevTitle}
          className={PANE_HEADER_ACTION_NAV_CLASS}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      ) : null}
      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label={nextTitle}
          title={nextTitle}
          className={PANE_HEADER_ACTION_NAV_CLASS}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

// ─── PaneHeaderWeekNav ──────────────────────────────────────────────────────
// Range label + prev/next buttons — the original WeekHeader right-slot.

interface PaneHeaderWeekNavProps {
  rangeLabel: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  /** When 0 (current week), Next is disabled. */
  weekOffset?: number;
}

export function PaneHeaderWeekNav({
  rangeLabel,
  onPrev,
  onNext,
  weekOffset = 0,
}: PaneHeaderWeekNavProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-black uppercase tracking-widest text-neutral-900">
        {rangeLabel}
      </span>
      <button
        onClick={onPrev}
        type="button"
        className="rounded-lg bg-neutral-300 p-1.5 text-neutral-900 transition-colors hover:bg-neutral-400 active:bg-neutral-500"
        title="Previous week"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={onNext}
        type="button"
        disabled={weekOffset === 0}
        className="rounded-lg bg-neutral-300 p-1.5 text-neutral-900 transition-colors hover:bg-neutral-400 active:bg-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100"
        title="Next week"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
