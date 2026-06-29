'use client';

import type { ComponentType, ReactNode, SVGProps } from 'react';
import Link from 'next/link';
import { ChevronLeft } from '../../Icons';
import { cn } from '@/utils/_cn';
import { PaneHeader } from './PaneHeader';
import {
  PaneHeaderCount,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderTitle,
  PaneHeaderCloseButton,
} from './blocks';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Single page-header for the whole app. Locks the 44px row height so every
 * page lines up with the sidebar back button. Custom slot content is allowed,
 * but the row's padding/height are NOT — that is the whole point.
 *
 * Composition rule: pick ONE of `title` or `eyebrow+value`. If you need
 * something more exotic, drop down to {@link PaneHeader} directly — but
 * understand you are opting out of the alignment guarantee.
 */
interface PageHeaderProps {
  // ── Identity (pick one) ────────────────────────────────────────────────
  /** Single bold title — e.g. "Receiving", "Settings". */
  title?: ReactNode;
  /** Two-line label: small eyebrow above a bold value. Used by detail panes. */
  eyebrow?: ReactNode;
  /** Bold identifier paired with `eyebrow`. */
  value?: ReactNode;
  /** Tooltip for the value when truncated. */
  valueTitle?: string;

  // ── Left decorations ───────────────────────────────────────────────────
  /** Optional icon badge on the far left (e.g. the blue PO pin). */
  icon?: IconComponent;
  /** Tailwind bg class for the icon badge (e.g. `bg-blue-50`). */
  iconBg?: string;
  /** Tailwind text class for the icon badge (e.g. `text-blue-600`). */
  iconTint?: string;
  /** Back button — pass a href or onClick. Renders a 44px-tall chevron button. */
  backHref?: string;
  onBack?: () => void;

  // ── Inline meta ────────────────────────────────────────────────────────
  /** Right-of-title numeric count (blue tabular). */
  count?: number;
  /** Slot for a status pill / chip — rendered after the title block. */
  metaSlot?: ReactNode;

  // ── Right side ─────────────────────────────────────────────────────────
  /** Right-side actions — buttons, week nav, etc. */
  rightSlot?: ReactNode;
  /** Standard X close button on the far right. */
  onClose?: () => void;

  // ── Secondary row ──────────────────────────────────────────────────────
  /** Optional content below the 44px row (tabs, filter chips). Does NOT
   *  affect the main row's height. */
  belowSlot?: ReactNode;

  // ── Escape hatches (use sparingly) ─────────────────────────────────────
  /** Override shell classes (background, border, sticky behavior). Cannot
   *  change the row's height/padding. */
  className?: string;
  /** Center the row on wide pages (e.g. `4xl` for Settings). */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';
}

const BACK_BUTTON_CLASS =
  'inline-flex h-8 w-8 -ml-1 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95';

export function PageHeader({
  title,
  eyebrow,
  value,
  valueTitle,
  icon,
  iconBg,
  iconTint,
  backHref,
  onBack,
  count,
  metaSlot,
  rightSlot,
  onClose,
  belowSlot,
  className,
  maxWidth,
}: PageHeaderProps) {
  if (process.env.NODE_ENV !== 'production') {
    const hasTitle = title != null;
    const hasLabel = value != null;
    if (hasTitle && hasLabel) {
      console.warn('PageHeader: pass either `title` or `eyebrow`+`value`, not both.');
    }
    if (!hasTitle && !hasLabel) {
      console.warn('PageHeader: missing identity — pass `title` or `value`.');
    }
  }

  const backEl = backHref ? (
    <Link href={backHref} aria-label="Back" className={BACK_BUTTON_CLASS}>
      <ChevronLeft className="h-5 w-5" />
    </Link>
  ) : onBack ? (
    <button type="button" onClick={onBack} aria-label="Back" className={cn(BACK_BUTTON_CLASS, 'ds-raw-button')}>
      <ChevronLeft className="h-5 w-5" />
    </button>
  ) : null;

  const identity = value != null ? (
    <PaneHeaderLabel eyebrow={eyebrow} value={value} valueTitle={valueTitle} />
  ) : title != null ? (
    <PaneHeaderTitle>{title}</PaneHeaderTitle>
  ) : null;

  return (
    <PaneHeader
      className={cn(className)}
      maxWidth={maxWidth}
      leftSlot={
        <>
          {backEl}
          {icon ? <PaneHeaderIconBadge Icon={icon} bg={iconBg} tint={iconTint} /> : null}
          {identity}
          {count != null ? <PaneHeaderCount count={count} /> : null}
          {metaSlot}
        </>
      }
      rightSlot={
        rightSlot != null || onClose != null ? (
          <>
            {rightSlot}
            {onClose ? <PaneHeaderCloseButton onClick={onClose} /> : null}
          </>
        ) : null
      }
      belowSlot={belowSlot}
    />
  );
}
