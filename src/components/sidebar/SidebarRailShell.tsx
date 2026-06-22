'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { staggerRevealContainer } from '@/design-system/primitives/StaggerReveal';
import { useSidebarRail } from './rail-shell/useSidebarRail';
import { RailEditPencil } from './rail-shell/RailEditPencil';
import { RailRow } from './rail-shell/RailRow';
import { PkgGroupHeader } from './rail-shell/PkgGroupHeader';
import type { SidebarRailShellProps } from './rail-shell/sidebar-rail-shared';

/**
 * Generic sidebar "recent activity" rail skeleton. Owns the reusable shell —
 * data fetch, optimistic patch, query invalidation, top-N + pinned-selection,
 * package grouping, keyboard nav, and the hover-preview popover positioning —
 * and pushes all domain-specific rendering out to render-prop slots.
 *
 * Receiving/Testing consume this via RecentActivityRailBase (which supplies the
 * ReceivingLineRow renderers); FBA supplies its own row + popover content.
 *
 * Thin composition shell: the engine lives in {@link useSidebarRail}; rows /
 * group headers / popover are presentational components under `./rail-shell/`.
 */

export { railRelativeTime, type SidebarRailRowContext, type SidebarRailShellProps } from './rail-shell/sidebar-rail-shared';
export { RailPopover } from './rail-shell/RailPopover';

export function SidebarRailShell<TRow>(props: SidebarRailShellProps<TRow>) {
  const {
    selectedId,
    eyebrowTitle, eyebrowSuffix, eyebrowAction, emptyText = 'No recent activity yet.',
    staggerReveal = false,
    getId, getActivityAt, onSelect, getStatusDot, getStatusDotLabel,
    renderRowMain, renderPopover,
  } = props;

  const {
    editMode, isLoading, rows, topCount, grouped,
    collapsedGroups, toggleGroup, listRef, focusIndex, setFocusIndex,
    handleKeyDown, handleEditClick,
  } = useSidebarRail(props);

  return (
    <section className="border-t border-gray-100 bg-white">
      <div className={`flex items-center justify-between ${SIDEBAR_GUTTER} py-1`}>
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          {eyebrowTitle} · {topCount}
        </p>
        <div className="flex items-center gap-2">
          {eyebrowAction
            ? eyebrowAction
            : eyebrowSuffix && (
                // leading-none: without it the 8.5px suffix inherits the base
                // line-height (1.5 ≈ 12.75px), taller than the 9px/lh-1.2 eyebrow
                // title — which made the suffixed rail (Unfound) ~2px taller than
                // the action-button rail (Found). Tight leading lets the title
                // govern the row height so both eyebrows align.
                <p className="text-[8.5px] font-bold uppercase leading-none tracking-widest text-gray-300">{eyebrowSuffix}</p>
              )}
          {editMode.enabled ? (
            <RailEditPencil active={editMode.active} onToggle={editMode.toggleActive} />
          ) : null}
        </div>
      </div>
      {isLoading && rows.length === 0 ? (
        <div className={`space-y-1 ${SIDEBAR_GUTTER} py-2`}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 w-full animate-pulse rounded-md bg-gray-100" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className={`${SIDEBAR_GUTTER} py-3 text-micro font-semibold text-gray-400`}>{emptyText}</p>
      ) : (
        <motion.ul
          ref={listRef}
          className={`${SIDEBAR_GUTTER} py-1 outline-none`}
          role="listbox"
          aria-label={`${eyebrowTitle} activity`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          {...(staggerReveal
            ? { initial: 'hidden' as const, animate: 'show' as const, variants: staggerRevealContainer() }
            : {})}
        >
          {/* `initial` enabled only for the reveal so the first-load cascade plays;
              otherwise AnimatePresence suppresses the initial mount animation. */}
          <AnimatePresence initial={staggerReveal}>
            {rows.flatMap((row, idx) => {
              const g = grouped[idx];
              const isCollapsed = g.groupId != null && collapsedGroups.has(g.groupId);
              if (isCollapsed && g.groupIndex > 0) return [];
              const isLeaderOfMulti = g.groupSize > 1 && g.groupIndex === 0 && g.groupId != null;
              const showExpandedHeader = isLeaderOfMulti && !isCollapsed;
              const nodes: React.ReactElement[] = [];
              if (showExpandedHeader) {
                nodes.push(
                  <PkgGroupHeader key={`pkg-${g.groupId}`} groupSize={g.groupSize} isCollapsed={false} staggerReveal={staggerReveal} onToggle={() => toggleGroup(g.groupId as number)} />,
                );
              }
              nodes.push(
                <RailRow
                  key={getId(row)}
                  row={row}
                  index={idx}
                  staggerReveal={staggerReveal}
                  isSelected={getId(row) === selectedId}
                  isFocused={idx === focusIndex}
                  editActive={editMode.active}
                  isChecked={editMode.active && editMode.selectedIds.has(getId(row))}
                  groupSize={g.groupSize}
                  groupIndex={g.groupIndex}
                  isCollapsed={isCollapsed}
                  showInlinePkgChip={isLeaderOfMulti && isCollapsed}
                  onToggleGroup={isLeaderOfMulti ? () => toggleGroup(g.groupId as number) : undefined}
                  getStatusDot={getStatusDot}
                  getStatusDotLabel={getStatusDotLabel}
                  getActivityAt={getActivityAt}
                  renderRowMain={renderRowMain}
                  renderPopover={renderPopover}
                  onClick={(e) => {
                    setFocusIndex(idx);
                    if (editMode.active) handleEditClick(idx, e?.shiftKey ?? false);
                    else onSelect(row);
                  }}
                />,
              );
              return nodes;
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}
