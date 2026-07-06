'use client';

import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Variants } from 'framer-motion';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { Check, ChevronDown } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { railRelativeTime, type SidebarRailRowContext } from './sidebar-rail-shared';
import { RailPopover } from './RailPopover';
import { useRailHoverPreview } from './useRailHoverPreview';

export function RailRow<TRow>({
  row, index, isSelected, isFocused, editActive, isChecked, isDisabled, groupSize, groupIndex, isCollapsed, showInlinePkgChip,
  staggerCascade, staggerItemVariants, onToggleGroup, getStatusDot, getStatusDotLabel, getActivityAt, renderRowMain, renderPopover, onClick,
}: {
  row: TRow;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  editActive: boolean;
  isChecked: boolean;
  isDisabled?: boolean;
  groupSize: number;
  groupIndex: number;
  isCollapsed: boolean;
  showInlinePkgChip: boolean;
  /** True when this row is part of the first-load stagger cascade. */
  staggerCascade: boolean;
  /** When set, rows enter with these variants (cascade or individually). */
  staggerItemVariants?: Variants;
  onToggleGroup?: () => void;
  getStatusDot: (row: TRow) => string;
  getStatusDotLabel?: (row: TRow) => string;
  getActivityAt?: (row: TRow) => string | null | undefined;
  renderRowMain: (row: TRow, ctx: SidebarRailRowContext) => ReactNode;
  renderPopover?: (row: TRow, ctx: { groupSize: number; openWorkspace: () => void; dismiss: () => void }) => ReactNode;
  /** Event is absent when invoked synthetically (popover "Open →"). */
  onClick: (e?: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const isGrouped = groupSize > 1;
  const isGroupLast = isGrouped && groupIndex === groupSize - 1;
  const isLeader = isGrouped && groupIndex === 0;
  const railIsFirst = isCollapsed ? isLeader : false;
  const railIsLast = isCollapsed ? isLeader : isGroupLast;

  const rowRef = useRef<HTMLLIElement | null>(null);
  // Shared hover-preview engine. Disabled in edit mode — that surface is for
  // picking rows, and the popover's "Open →" CTA contradicts click-to-check.
  const { isOpen: previewOpen, scheduleOpen, scheduleClose, dismiss } = useRailHoverPreview({
    enabled: Boolean(renderPopover) && !editActive && !isDisabled,
  });

  const pkgChip = showInlinePkgChip ? (
    <HoverTooltip label={`Expand — show ${groupSize - 1} more in this package`} asChild focusable={false}>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onToggleGroup?.(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleGroup?.(); } }}
        aria-expanded={false}
        aria-label="Expand package"
        className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-indigo-100 px-1 py-px text-[8.5px] font-black uppercase tracking-widest text-indigo-700 transition-colors hover:bg-indigo-200"
      >
        <motion.span animate={{ rotate: -90 }} transition={{ duration: 0.18, ease: motionBezier.easeOut }} className="inline-flex">
          <ChevronDown className="h-2.5 w-2.5" />
        </motion.span>
        PKG · {groupSize}
        <span className="ml-0.5 text-indigo-500/80">·</span>
        <span className="text-indigo-500/80">+{groupSize - 1}</span>
      </span>
    </HoverTooltip>
  ) : null;

  const activityAt = getActivityAt?.(row);

  // Stagger mode: inherit the parent <ul>'s hidden→show timeline when part of the
  // first-load cascade; otherwise play the same variants individually (e.g. a
  // freshly-scanned row arriving after the cascade). Default: opacity-only.
  const motionProps = staggerItemVariants
    ? staggerCascade
      ? { variants: staggerItemVariants }
      : { initial: 'hidden' as const, animate: 'show' as const, variants: staggerItemVariants }
    : { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, pointerEvents: 'none' as const }, transition: { duration: 0.12, ease: motionBezier.easeOut } };

  return (
    <motion.li
      ref={rowRef}
      role="option"
      aria-selected={editActive ? isChecked : isSelected}
      {...motionProps}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      {isGrouped ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 z-10 w-[2px] bg-indigo-300 ${
            railIsFirst
              ? railIsLast ? 'top-1.5 bottom-1.5 rounded-full' : 'top-1.5 bottom-0 rounded-t-full'
              : railIsLast ? 'top-0 bottom-1.5 rounded-b-full' : 'inset-y-0'
          }`}
        />
      ) : null}
      <button
        type="button"
        data-rail-row
        data-rail-index={index}
        tabIndex={-1}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        onClick={onClick}
        // Shift-click range select: stop the browser's native shift-click text
        // selection from highlighting row labels across the range.
        onMouseDown={(e) => { if (editActive && e.shiftKey) e.preventDefault(); }}
        className={`ds-raw-button group relative flex w-full gap-2.5 text-left transition-colors ${isGrouped ? 'pl-3 pr-2' : 'px-2'} ${
          isDisabled ? 'cursor-wait opacity-80' : ''
        } ${
          (editActive ? isChecked : isSelected)
            ? 'items-center rounded-md bg-blue-50 ring-1 ring-inset ring-blue-400 py-1.5'
            : `items-center rounded-md py-1.5 ${isFocused ? 'bg-surface-canvas ring-1 ring-inset ring-border-soft' : 'hover:bg-surface-hover'}`
        }`}
      >
        {editActive ? (
          <span
            aria-hidden
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
              isChecked ? 'border-blue-600 bg-blue-600 text-white' : 'border-border-default bg-surface-card'
            }`}
          >
            {isChecked ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
        ) : null}
        {getStatusDotLabel ? (
          <HoverTooltip label={getStatusDotLabel(row)} focusable={false} asChild>
            <span
              className={`block h-2 w-2 shrink-0 rounded-full ${getStatusDot(row)}`}
              aria-label={getStatusDotLabel(row)}
            />
          </HoverTooltip>
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${getStatusDot(row)}`} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {renderRowMain(row, { isSelected, isFocused, pkgChip })}
        </div>
        {activityAt != null ? (
          <span className="shrink-0 self-center tabular-nums text-micro font-medium text-text-faint">
            {railRelativeTime(activityAt)}
          </span>
        ) : null}
      </button>
      <AnimatePresence>
        {previewOpen && renderPopover ? (
          <RailPopover anchorEl={rowRef.current} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} onDismiss={dismiss}>
            {renderPopover(row, { groupSize, openWorkspace: onClick, dismiss })}
          </RailPopover>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}
