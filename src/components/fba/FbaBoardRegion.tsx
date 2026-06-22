'use client';

/**
 * Center region of the FBA page: the board table (PLANNED in plan mode, the
 * PACKED queue in combine), the "Combine items" selection action bar that floats
 * over it, and the combine workspace that crossfades over the board after
 * "Combine items" is pressed. Also handles the error + shipped-mode states.
 * Pure presentational; state comes from the page's hooks. Extracted from
 * fba/page; behaviour is unchanged.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { Package } from '@/components/Icons';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { stationThemeColors } from '@/utils/staff-colors';
import { FbaErrorState } from '@/components/fba/FbaStateShells';
import { FbaBoardTable, type FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaCombineWorkspace } from '@/components/fba/sidebar/FbaCombineWorkspace';
import { FBA_BOARD_TOGGLE_ALL } from '@/lib/fba/events';
import type { StationTheme } from '@/hooks/useStationTheme';
import type { FbaMode } from '@/lib/fba/fba-modes';
import type { FbaWeekFilter } from '@/app/fba/useFbaWeekFilter';
import type { FbaCombine } from '@/app/fba/useFbaCombine';

interface FbaBoardRegionProps {
  error: string | null;
  onRetry: () => void;
  activeMode: FbaMode;
  stationTheme: StationTheme;
  prefersReducedMotion: boolean | null;
  loading: boolean;
  hasBoardItems: boolean;
  weekFilter: FbaWeekFilter;
  combine: FbaCombine;
  onDetailOpen: (item: FbaBoardItem) => void;
}

export function FbaBoardRegion({
  error,
  onRetry,
  activeMode,
  stationTheme,
  prefersReducedMotion,
  loading,
  hasBoardItems,
  weekFilter,
  combine,
  onDetailOpen,
}: FbaBoardRegionProps) {
  if (error) {
    return <FbaErrorState message={error} onRetry={onRetry} theme={stationTheme} />;
  }

  if (activeMode === 'shipped') {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-5 text-center">
        <p className="max-w-sm text-caption font-black uppercase tracking-widest text-gray-400">
          Shipped mode is managed from the sidebar table.
        </p>
      </div>
    );
  }

  const { weekRange, weekOffset, setWeekOffset, filteredPendingItems, boardEmptyMessage } = weekFilter;
  const { boardSelection, selectedUnits, workspaceActive, showCombineBar, handleStartCombine } =
    combine;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* Board (PLANNED in plan mode, PACKED queue in combine). Stays mounted
          under the combine workspace so the sidebar Packed rail can keep folding
          items into the selection. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <FbaBoardTable
          items={filteredPendingItems}
          loading={loading && !hasBoardItems}
          stationTheme={stationTheme}
          emptyMessage={boardEmptyMessage}
          onDetailOpen={onDetailOpen}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset((o) => o - 1)}
          onNextWeek={() => setWeekOffset((o) => Math.min(0, o + 1))}
        />
      </div>

      {/* Selection action bar: floats over the board once packed items are
          selected. Pressing "Combine items" is what opens the workspace (not the
          first selection) so multiple items can be picked first. */}
      <AnimatePresence>
        {showCombineBar && (
          <motion.div
            key="fba-combine-bar"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: 0.18, ease: motionBezier.easeOut }}
            className="absolute inset-x-0 bottom-0 z-20"
          >
            <StickyActionBar
              maxWidth="max-w-none"
              leading={
                <span className="text-micro font-black uppercase tracking-widest tabular-nums text-gray-500">
                  {boardSelection.length} item{boardSelection.length === 1 ? '' : 's'} · {selectedUnits} unit{selectedUnits === 1 ? '' : 's'} selected
                </span>
              }
              secondary={{
                label: 'Clear',
                onClick: () =>
                  window.dispatchEvent(new CustomEvent(FBA_BOARD_TOGGLE_ALL, { detail: 'none' })),
              }}
              primary={{
                label: 'Combine items',
                onClick: handleStartCombine,
                icon: <Package className="h-4 w-4 shrink-0" />,
                toneClasses: {
                  bg: stationThemeColors[stationTheme].bg,
                  hover: stationThemeColors[stationTheme].hover,
                },
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combine workspace (combine mode only): crossfades over the board after
          "Combine items" is pressed. Always mounted (opacity-crossfaded) so
          FbaActiveShipments keeps listening for open-editor. */}
      {activeMode === 'combine' && (
        <motion.div
          className="absolute inset-0 z-10 bg-white"
          initial={false}
          animate={
            prefersReducedMotion
              ? { opacity: workspaceActive ? 1 : 0 }
              : { opacity: workspaceActive ? 1 : 0, y: workspaceActive ? 0 : 6 }
          }
          transition={{ duration: 0.18, ease: motionBezier.easeOut }}
          style={{ pointerEvents: workspaceActive ? 'auto' : 'none' }}
          aria-hidden={!workspaceActive}
        >
          <FbaCombineWorkspace
            selectedItems={boardSelection}
            stationTheme={stationTheme}
            onClose={() => combine.setCombineOpen(false)}
          />
        </motion.div>
      )}
    </div>
  );
}
