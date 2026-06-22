'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { WorkOrderInfoChips } from '@/components/work-orders/WorkOrderInfoStrip';
import { AssignmentOverlayCard } from './AssignmentOverlayCard';
import { StaffButtonGrid } from '@/components/shipping/StaffButtonGrid';
import { assignmentHeaderContextText, type WorkOrderAssignmentCardProps } from './work-order-assignment/work-order-assignment-shared';
import { useWorkOrderAssignmentCard } from './work-order-assignment/useWorkOrderAssignmentCard';

export type {
  AssignmentStaffContext,
  AssignmentConfirmPayload,
  WorkOrderAssignmentCardProps,
} from './work-order-assignment/work-order-assignment-shared';

/**
 * Carousel assignment card — thin composition shell. The full state machine
 * (drafts + localStorage persistence, resume-to-next, debounced autosave,
 * confirm→advance, keyboard nav) lives in {@link useWorkOrderAssignmentCard};
 * pure helpers + types live in `./work-order-assignment/`.
 */
export function WorkOrderAssignmentCard(props: WorkOrderAssignmentCardProps) {
  const { technicianOptions, packerOptions, onClose, staffContext } = props;
  const c = useWorkOrderAssignmentCard(props);
  const {
    row,
    techId, packerId, deadline, setDeadline, updateCurrentDraft,
    hasPrev, hasNext, navigate,
    remaining, todayUnassignedCount, todayTotalCount,
    handleTech, handlePacker, handleMarkDone, handleMarkShipped,
  } = c;

  if (!row) return null;

  const topBar = (
    <div className="flex items-center justify-between gap-2 px-4 py-2">
      <button
        type="button"
        disabled={!hasPrev}
        onClick={() => navigate('prev')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-20"
        aria-label="Previous"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="min-w-0 text-center leading-tight">
        <p className="text-eyebrow font-black uppercase tracking-[0.22em] text-gray-500">
          {remaining} remaining
        </p>
        <p className="mt-0.5 text-mini font-black uppercase tracking-[0.16em] text-gray-500">
          {todayUnassignedCount} unassigned · {todayTotalCount} total today
        </p>
      </div>

      <button
        type="button"
        disabled={!hasNext}
        onClick={() => navigate('next')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-20"
        aria-label="Next"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const headerEyebrow = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex min-h-[26px] min-w-0 flex-1 items-center">
        <span className="truncate text-sm font-black uppercase tracking-[0.08em] leading-none text-gray-500">
          {assignmentHeaderContextText(row)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <WorkOrderInfoChips row={row} />
      </div>
    </div>
  );

  return (
    <AssignmentOverlayCard
      topBar={topBar}
      headerEyebrow={headerEyebrow}
      onClose={onClose}
      className="min-h-[28rem]"
      widthClassName="w-[96vw] max-w-[780px] sm:w-[760px]"
      headerClassName="!py-2"
      dialogPosition="center"
      showHeaderGradient={false}
      bodyClassName="p-0"
      showCloseButton={false}
    >
      <div className="flex min-w-0 flex-col">
        <div
          className="flex min-w-0 items-start px-5 pb-2 pt-1"
          style={{ height: '7.75rem', overflow: 'hidden' }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.h2
              key={row.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="break-words text-2xl font-black leading-tight tracking-tight text-gray-950 [overflow-wrap:anywhere]"
              style={{
                height: '100%',
                overflowY: 'auto',
                paddingRight: '0.25rem',
                scrollbarGutter: 'stable',
              }}
            >
              {row.title}
            </motion.h2>
          </AnimatePresence>
        </div>

        <div className="shrink-0 space-y-4 border-t border-gray-100 px-5 pb-5 pt-2.5">
          <div>
            <StaffButtonGrid
              label="Technician"
              options={technicianOptions}
              selectedId={techId}
              onSelect={handleTech}
              emptyMessage="No technicians"
            />
            {staffContext && (staffContext.techniciansOff?.length || staffContext.techniciansInactive?.length) ? (
              <p className="mt-1.5 text-eyebrow font-bold text-gray-400">
                Unavailable: {[
                  ...(staffContext.techniciansOff || []).map((m) => `${m.name} (Off today)`),
                  ...(staffContext.techniciansInactive || []).map((m) => `${m.name} (Inactive)`),
                ].join(', ')}
              </p>
            ) : null}
          </div>

          <div>
            <StaffButtonGrid
              label="Packer"
              options={packerOptions}
              selectedId={packerId}
              onSelect={handlePacker}
              columns={2}
              emptyMessage="No packers"
            />
            {staffContext && (staffContext.packersOff?.length || staffContext.packersInactive?.length) ? (
              <p className="mt-1.5 text-eyebrow font-bold text-gray-400">
                Unavailable: {[
                  ...(staffContext.packersOff || []).map((m) => `${m.name} (Off today)`),
                  ...(staffContext.packersInactive || []).map((m) => `${m.name} (Inactive)`),
                ].join(', ')}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <span className="text-eyebrow font-black uppercase tracking-[0.22em] text-gray-500">
              Deadline
            </span>
            <input
              type="date"
              value={deadline}
              onChange={(e) => {
                const next = e.target.value;
                setDeadline(next);
                updateCurrentDraft({ deadline: next });
              }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-micro font-bold text-gray-800 outline-none transition-colors focus:border-gray-400 tabular-nums"
            />
          </div>

          <div className={`grid gap-2 ${row.entityType === 'ORDER' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              onClick={handleMarkDone}
              className="h-8 rounded-lg border border-gray-200 bg-gray-50 text-eyebrow font-black uppercase tracking-[0.18em] text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100"
            >
              Mark as Done
            </button>
            {row.entityType === 'ORDER' && (
              <button
                type="button"
                onClick={handleMarkShipped}
                className="h-8 rounded-lg bg-emerald-600 text-eyebrow font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-emerald-700 shadow-sm"
              >
                Mark as Shipped
              </button>
            )}
          </div>
        </div>
      </div>
    </AssignmentOverlayCard>
  );
}
