'use client';

import {
  useCallback, useEffect, useRef, useState,
  type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { Check, ChevronDown } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { staggerRevealItem } from '@/design-system/primitives/StaggerReveal';
import { railRelativeTime, type SidebarRailRowContext } from './sidebar-rail-shared';
import { RailPopover } from './RailPopover';

export function RailRow<TRow>({
  row, index, isSelected, isFocused, editActive, isChecked, groupSize, groupIndex, isCollapsed, showInlinePkgChip,
  staggerReveal, onToggleGroup, getStatusDot, getStatusDotLabel, getActivityAt, renderRowMain, renderPopover, onClick,
}: {
  row: TRow;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  editActive: boolean;
  isChecked: boolean;
  groupSize: number;
  groupIndex: number;
  isCollapsed: boolean;
  showInlinePkgChip: boolean;
  staggerReveal: boolean;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const scheduleOpen = useCallback(() => {
    // Edit mode: no hover previews — the surface is for picking rows, and the
    // popover's "Open →" CTA contradicts the click-to-check behavior.
    if (!renderPopover || editActive) return;
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (previewOpen || openTimer.current) return;
    openTimer.current = window.setTimeout(() => { openTimer.current = null; setPreviewOpen(true); }, 200);
  }, [previewOpen, renderPopover, editActive]);

  // Entering edit mode mid-hover: dismiss any preview already showing.
  useEffect(() => { if (editActive) setPreviewOpen(false); }, [editActive]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setPreviewOpen(false); }, 150);
  }, []);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const pkgChip = showInlinePkgChip ? (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onToggleGroup?.(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleGroup?.(); } }}
      title={`Expand — show ${groupSize - 1} more in this package`}
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
  ) : null;

  const activityAt = getActivityAt?.(row);

  // Stagger mode: inherit the parent <ul>'s hidden→show timeline via variants
  // (exit lives in the variant too). Default mode: opacity-only enter/exit with
  // no initial mount animation, as before.
  const motionProps = staggerReveal
    ? { variants: staggerRevealItem }
    : { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12, ease: motionBezier.easeOut } };

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
        onClick={onClick}
        // Shift-click range select: stop the browser's native shift-click text
        // selection from highlighting row labels across the range.
        onMouseDown={(e) => { if (editActive && e.shiftKey) e.preventDefault(); }}
        className={`relative flex w-full gap-2.5 text-left transition-colors ${isGrouped ? 'pl-3 pr-2' : 'px-2'} ${
          (editActive ? isChecked : isSelected)
            ? 'items-center rounded-md bg-blue-50 ring-1 ring-inset ring-blue-400 py-1.5'
            : `items-center rounded-md py-1.5 ${isFocused ? 'bg-gray-50 ring-1 ring-inset ring-gray-200' : 'hover:bg-gray-50'}`
        }`}
      >
        {editActive ? (
          <span
            aria-hidden
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
              isChecked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
            }`}
          >
            {isChecked ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
        ) : null}
        {getStatusDotLabel ? (
          <HoverTooltip label={getStatusDotLabel(row)} focusable={false} className="shrink-0">
            <span
              className={`block h-2 w-2 rounded-full ${getStatusDot(row)}`}
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
          <span className="shrink-0 self-center tabular-nums text-micro font-medium text-gray-400">
            {railRelativeTime(activityAt)}
          </span>
        ) : null}
      </button>
      <AnimatePresence>
        {previewOpen && renderPopover ? (
          <RailPopover anchorEl={rowRef.current} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} onDismiss={() => setPreviewOpen(false)}>
            {renderPopover(row, { groupSize, openWorkspace: onClick, dismiss: () => setPreviewOpen(false) })}
          </RailPopover>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}
