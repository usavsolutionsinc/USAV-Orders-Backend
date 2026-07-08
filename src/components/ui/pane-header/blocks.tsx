'use client';

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from '../../Icons';
import { HoverTooltip } from '../HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { receivingHeaderHairlineClass } from '@/components/layout/header-shell';
import { RECEIVING_WORKSPACE_HEADER_COLUMN } from '@/components/receiving/workspace/receiving-workspace-layout';

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
  'text-eyebrow font-black uppercase tracking-widest text-text-faint';

export const paneHeaderLabelValueClass =
  'truncate text-sm font-black tracking-tight text-text-default';

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
      {/* ds-allow-title: native OS tooltip shows the full value when truncated */}
      <span className={valueClassName} title={valueTitle}>
        {value}
      </span>
    </div>
  );
}

// ─── PaneHeaderTitle ────────────────────────────────────────────────────────
// Single bold title — matches the WeekHeader "today" / sticky-date display.

const paneHeaderHighContrastTitleClass =
  'text-sm font-black uppercase tracking-widest text-text-default';

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
    <HoverTooltip label={title} asChild>
      <IconButton
        type="button"
        onClick={onClick}
        ariaLabel={ariaLabel}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-sunken active:scale-95',
          className,
        )}
        icon={<X className="h-4 w-4" />}
      />
    </HoverTooltip>
  );
}

// ─── PaneHeaderStatusPill ───────────────────────────────────────────────────
// Small status pill — sits inline next to the label/value to call out current
// state. Matches the Plain / Pylon / ops-dashboard pattern surfaced by 2026
// research (status as headline, not as right-meta sidebar like Linear).

type StatusTone = 'neutral' | 'blue' | 'emerald' | 'amber' | 'yellow' | 'rose' | 'red' | 'purple';

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-surface-sunken text-text-muted ring-border-soft',
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
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-black uppercase tracking-widest ring-1 ring-inset',
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
            tone === 'neutral' && 'bg-slate-500', // ds-allow-raw-neutral: identity/tone hue — neutral pulse dot among colored tones
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
        'flex items-center gap-1 bg-surface-card px-2 py-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          // ds-raw-button: segmented tab (role="tab" + aria-selected + active fill + count), not a Button/IconButton
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              active
                ? 'bg-surface-inverse text-white'
                : 'text-text-muted hover:bg-surface-sunken hover:text-text-default',
            )}
          >
            <span>{tab.label}</span>
            {tab.count != null ? (
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-white/70' : 'text-text-faint',
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
  /** Selected/pressed state — highlights the button so the user sees which action's panel is open. */
  active?: boolean;
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
  /**
   * Card = rounded pill with subtle border + shadow. Flat = no chrome.
   * Header = full-width 30px band with a top hairline, matching the house
   * header rows (e.g. the workspace toolbar pinned beneath the stepper).
   */
  variant?: 'card' | 'flat' | 'header';
  /** Icon-only mode — hides text labels but preserves them as aria-label/title for accessibility. */
  iconOnly?: boolean;
  /** Custom node pinned to the right, before the prev/next chevrons (e.g. an Info button). */
  rightSlot?: ReactNode;
  /** Extra classes applied to prev/next nav buttons (e.g. responsive hide). */
  navClassName?: string;
  className?: string;
}

const PANE_HEADER_ACTION_BTN_CLASS =
  'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-micro font-bold uppercase tracking-widest text-text-soft transition-colors hover:bg-surface-hover hover:text-text-default disabled:cursor-not-allowed disabled:opacity-40';

const PANE_HEADER_ACTION_NAV_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-soft transition-colors hover:bg-surface-hover hover:text-text-default disabled:cursor-not-allowed disabled:opacity-40';

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
  rightSlot,
  navClassName,
  className,
}: PaneHeaderActionBarProps) {
  const shell =
    variant === 'card'
      ? 'flex items-center gap-2 rounded-xl border border-border-soft/70 bg-surface-card px-3 py-1.5 shadow-sm'
      : 'flex items-center gap-2 px-2 py-1.5';

  const renderText = (value: ReactNode): string | undefined =>
    typeof value === 'string' ? value : undefined;

  const content = (
    <>
      {actions.map((action) => (
        <HoverTooltip
          key={action.key}
          label={action.title ?? renderText(action.label) ?? action.key}
          asChild
        >
          {/* ds-raw-button: compact 28px toolbar action that is icon-only OR icon+label and wraps the icon in a per-action toneClassName span — Button's icon-box sizing can't preserve that */}
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            aria-label={action.ariaLabel ?? renderText(action.label) ?? action.key}
            aria-pressed={action.active}
            className={cn(
              PANE_HEADER_ACTION_BTN_CLASS,
              iconOnly && 'h-7 w-7 justify-center gap-0 px-0',
              action.active &&
                'bg-surface-sunken text-text-default ring-1 ring-inset ring-border-default hover:bg-surface-sunken',
            )}
          >
            <span className={cn('inline-flex items-center', action.toneClassName)}>{action.icon}</span>
            {iconOnly ? null : action.label}
          </button>
        </HoverTooltip>
      ))}
      {status != null ? (
        <span
          className="text-eyebrow font-black uppercase tracking-[0.18em] text-blue-600"
          aria-live="polite"
        >
          {status}
        </span>
      ) : null}
      {(onPrev || onNext || rightSlot) && <div className="flex-1" />}
      {rightSlot}
      {onPrev ? (
        <HoverTooltip label={prevTitle} asChild>
          <IconButton
            type="button"
            onClick={onPrev}
            disabled={prevDisabled}
            ariaLabel={prevTitle}
            className={cn(PANE_HEADER_ACTION_NAV_CLASS, navClassName)}
            icon={<ChevronUp className="h-4 w-4" />}
          />
        </HoverTooltip>
      ) : null}
      {onNext ? (
        <HoverTooltip label={nextTitle} asChild>
          <IconButton
            type="button"
            onClick={onNext}
            disabled={nextDisabled}
            ariaLabel={nextTitle}
            className={cn(PANE_HEADER_ACTION_NAV_CLASS, navClassName)}
            icon={<ChevronDown className="h-4 w-4" />}
          />
        </HoverTooltip>
      ) : null}
    </>
  );

  // Header = full-width 40px white band with the house bottom hairline (matches
  // the other header rows for consistency). Its content sits in the SAME
  // centered max-w-3xl column as the stepper + body cards so the icons (left)
  // and chevrons (right) line up with the rest of the workspace.
  if (variant === 'header') {
    return (
      <div className={cn('flex h-[40px] w-full shrink-0 items-center bg-surface-card', receivingHeaderHairlineClass, className)}>
        <div className={cn(RECEIVING_WORKSPACE_HEADER_COLUMN, 'flex items-center gap-1')}>
          {content}
        </div>
      </div>
    );
  }

  return <div className={cn(shell, className)}>{content}</div>;
}

// ─── PaneHeaderPagination ─────────────────────────────────────────────────────
// Range label + prev/next page controls — pairs with {@link PaneHeader} for
// paginated tables.

interface PaneHeaderPaginationProps {
  /** Current 1-based page index. */
  page: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function PaneHeaderPagination({
  page,
  pageSize,
  total,
  onPrev,
  onNext,
}: PaneHeaderPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  return (
    <div className="flex items-center gap-3">
      <span className="tabular-nums text-eyebrow font-black uppercase tracking-wider text-text-soft">
        {total > 0 ? (
          <>
            <span className="text-text-default">
              {rangeStart}–{rangeEnd}
            </span>{' '}
            <span className="text-text-faint">/</span>{' '}
            <span className="text-text-faint">{total.toLocaleString()}</span>
          </>
        ) : (
          '—'
        )}
      </span>
      <div className="flex items-center gap-0.5 rounded-md border border-border-soft bg-surface-card p-0.5">
        <HoverTooltip label="Previous page" asChild>
          <IconButton
            type="button"
            onClick={() => canPrev && onPrev()}
            disabled={!canPrev}
            ariaLabel="Previous page"
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            icon={<ChevronLeft className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
        <span className="px-1 tabular-nums text-eyebrow font-black uppercase tracking-wider text-text-soft">
          <span className="text-text-default">{safePage}</span>
          <span className="text-text-faint"> / {totalPages}</span>
        </span>
        <HoverTooltip label="Next page" asChild>
          <IconButton
            type="button"
            onClick={() => canNext && onNext()}
            disabled={!canNext}
            ariaLabel="Next page"
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            icon={<ChevronRight className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
      </div>
    </div>
  );
}
