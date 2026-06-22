import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Check, Clock, RotateCcw, Barcode } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { RECUR_INTERVALS, STATION_LABEL, toneFor } from './goal-chip-shared';
import { GoalRing } from './GoalRing';
import { TaskList } from './TaskList';
import type { HeaderGoalChipController } from './useHeaderGoalChip';

interface View { target: number; scanCount: number; done: number; total: number; percent: number }
type Tone = ReturnType<typeof toneFor>;
interface ChipCount { value: number; total: number; unit: string }

/** The goal-chip popover body: header + station switcher + the 3 mode panels. */
export function GoalPopover({
  g,
  view,
  tone,
  chipCount,
  hasSwitch,
}: {
  g: HeaderGoalChipController;
  view: View;
  tone: Tone;
  chipCount: ChipCount;
  hasSwitch: boolean;
}) {
  const active = g.active!;
  const goals = g.goals!;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className="w-[290px] origin-top-left overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_12px_40px_rgba(20,30,55,0.16)]"
    >
      {/* header: title + Switch (only when there are secondary stations) */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <GoalRing percent={view.percent} color={tone.ring} size={38} />
          <div className="leading-tight">
            <p className="text-[13px] font-bold tracking-tight text-gray-900">Today&apos;s {STATION_LABEL[active]} goal</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tabular-nums text-gray-500">
                {chipCount.value} / {chipCount.total}
              </span>
              <span className={cn('rounded-full px-1.5 py-px text-[8.5px] font-black uppercase tracking-wider ring-1', tone.chip)}>
                {tone.label}
              </span>
            </p>
          </div>
        </div>
        {hasSwitch && (
          <button
            type="button"
            onClick={() => g.setSwitching((s) => !s)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold transition-colors',
              g.switching ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <RotateCcw className="h-3 w-3" /> Switch
          </button>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {g.switching && hasSwitch ? (
          <motion.div
            key="switch"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="p-2"
          >
            <p className="px-2 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">Your stations</p>
            {goals.map((gg) => {
              const pct = gg.target <= 0 ? 0 : Math.round((gg.scanCount / gg.target) * 100);
              const gt = toneFor(pct);
              const on = gg.station === active;
              return (
                <button
                  key={gg.station}
                  type="button"
                  onClick={() => g.onSelectStation(gg.station)}
                  className={cn('flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors', on ? 'bg-blue-50/70' : 'hover:bg-gray-50')}
                >
                  <GoalRing percent={pct} color={gt.ring} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-gray-900">
                      {STATION_LABEL[gg.station]}
                      {gg.isPrimary && <span className="ml-1.5 text-[8.5px] font-black uppercase tracking-wider text-blue-500">primary</span>}
                    </span>
                    <span className="text-[9.5px] font-semibold tabular-nums text-gray-500">{gg.scanCount}/{gg.target} scans</span>
                  </span>
                  {on && <Check className="h-3.5 w-3.5 text-blue-600" />}
                </button>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="body"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            {/* mode toggle: Scans · Auto / Recurring / To-do */}
            <div className="px-3 pt-3">
              <div className="flex w-full items-center gap-0.5 rounded-xl bg-gray-100 p-0.5 ring-1 ring-gray-200">
                {(['scans', 'recurring', 'todo'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => g.changeMode(m)}
                    className={cn(
                      'relative flex-1 rounded-lg px-1.5 py-1.5 text-[10px] font-bold transition-colors',
                      g.mode === m ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-900',
                    )}
                  >
                    {m === 'scans' ? 'Scans · auto' : m === 'recurring' ? 'Recurring' : 'To-do'}
                    {m === 'recurring' && g.recurDue && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" />}
                  </button>
                ))}
              </div>
            </div>

            {g.mode === 'scans' ? (
              <div className="px-3.5 py-3.5">
                <div className="flex items-end justify-between">
                  <span className="text-[28px] font-extrabold leading-none tabular-nums text-gray-900">{view.scanCount}</span>
                  <span className="pb-0.5 text-[12px] font-bold tabular-nums text-gray-400">of {view.target}</span>
                </div>
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: tone.ring }}
                    animate={{ width: `${Math.min(100, view.percent)}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <p className="mt-2 flex items-center gap-1 text-[10.5px] font-semibold text-gray-500">
                  <Barcode className="h-3 w-3" />
                  Live deduped scans for this station.
                </p>
                <p className="mt-1 text-[10.5px] font-bold tabular-nums" style={{ color: tone.ring }}>
                  {Math.max(0, view.target - view.scanCount)} scans left to hit goal
                </p>
              </div>
            ) : g.mode === 'recurring' ? (
              <div>
                {/* whole-list reset interval */}
                <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
                  <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                    <Clock className="h-3 w-3" /> Resets every
                  </span>
                  <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 ring-1 ring-gray-200">
                    {RECUR_INTERVALS.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => g.changeInterval(opt.ms)}
                        className={cn(
                          'rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors',
                          g.intervalMs === opt.ms ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-900',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {g.recurDue && (
                  <p className="mt-1.5 flex items-center gap-1 px-3.5 text-[10.5px] font-bold text-rose-600">
                    <Bell className="h-3 w-3" /> Due now — re-check these tasks.
                  </p>
                )}

                <div className="mt-1 max-h-[200px] overflow-y-auto px-2 pb-2">
                  <TaskList
                    items={g.recurItems}
                    onToggle={g.toggleRecur}
                    onRemove={g.removeRecur}
                    adding={g.adding}
                    draft={g.draft}
                    onDraft={g.setDraft}
                    onAdd={g.onAddRecur}
                    onStartAdd={g.onStartAdd}
                    onCancelAdd={g.onCancelAdd}
                    emptyHint="No recurring tasks yet. These reset on the interval above."
                    placeholder="New recurring task…"
                    addLabel="Add recurring task"
                  />
                </div>
              </div>
            ) : (
              <div className="max-h-[230px] overflow-y-auto px-2 py-2">
                <TaskList
                  items={g.todoItems}
                  onToggle={g.toggleTodo}
                  onRemove={g.removeTodo}
                  adding={g.adding}
                  draft={g.draft}
                  onDraft={g.setDraft}
                  onAdd={g.onAddTodo}
                  onStartAdd={g.onStartAdd}
                  onCancelAdd={g.onCancelAdd}
                  emptyHint="No tasks yet. Add your to-dos."
                  placeholder="New task…"
                  addLabel="Add a task"
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
