'use client';

import { motion } from 'framer-motion';
import { AnchoredLayer } from '@/design-system';
import { ChevronDown } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { STATION_LABEL, toneFor } from './goal-chip/goal-chip-shared';
import { useHeaderGoalChip } from './goal-chip/useHeaderGoalChip';
import { GoalRing } from './goal-chip/GoalRing';
import { GoalPopover } from './goal-chip/GoalPopover';

/**
 * Header goal chip — the daily goal pinned to the {@link GlobalHeader}, following
 * the user across every page. A ring fills with progress; click to open a popover
 * with three modes (scans / recurring / to-do). Checklists are server-backed
 * (staff_todos); recurring done-ness is client-derived from each task's cycle.
 *
 * Thin composition layer — state/logic live under `./goal-chip/`.
 */
export function HeaderGoalChip() {
  const g = useHeaderGoalChip();

  if (!g.user || !g.goals || !g.active || !g.activeGoal || !g.view) return null;

  const view = g.view;
  const tone = toneFor(view.percent);
  const hasSwitch = g.goals.length > 1;
  const chipCount =
    g.mode === 'scans'
      ? { value: view.scanCount, total: view.target, unit: 'scans' }
      : { value: view.done, total: view.total, unit: 'tasks' };

  return (
    <div ref={g.wrapRef} className="relative shrink-0">
      <motion.button
        type="button"
        onClick={() => g.setOpen((o) => !o)}
        whileTap={{ scale: 0.97 }}
        aria-label="Daily goal"
        aria-expanded={g.open}
        title={`${STATION_LABEL[g.active]} goal — ${view.percent}%${g.recurDue ? ' · recurring tasks due' : ''}`}
        className={cn('flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 transition-colors', g.open ? 'bg-gray-100' : 'hover:bg-gray-100')}
      >
        <GoalRing percent={view.percent} color={tone.ring} />
        <span className="flex flex-col items-start leading-none">
          <span className="text-caption font-bold tracking-tight text-gray-900">{STATION_LABEL[g.active]}</span>
          <span className="mt-0.5 text-eyebrow font-semibold tabular-nums text-gray-500">
            {chipCount.value}/{chipCount.total} {chipCount.unit}
          </span>
        </span>
        <ChevronDown className={cn('h-3 w-3 text-gray-400 transition-transform duration-200', g.open && 'rotate-180')} />
      </motion.button>

      {/* in-app reminder: recurring tasks have come due for this station */}
      {g.recurDue && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        </span>
      )}

      <AnchoredLayer open={g.open} onClose={g.closePopover} anchorRef={g.wrapRef} placement="bottom-start" gap={8}>
        <GoalPopover g={g} view={view} tone={tone} chipCount={chipCount} hasSwitch={hasSwitch} />
      </AnchoredLayer>
    </div>
  );
}
