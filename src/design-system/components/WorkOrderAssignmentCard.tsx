'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, History } from '@/components/Icons';
import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';
import { getOrderPlatformLabel, getOrderSourceTag } from '@/utils/order-platform';
import { WorkOrderInfoChips } from '@/components/work-orders/WorkOrderInfoStrip';
import { toDateInputValue, type WorkOrderRow, type WorkStatus } from '@/components/work-orders/types';
import { AssignmentOverlayCard } from './AssignmentOverlayCard';
import { framerGesture, framerTransition } from '../foundations/motion-framer';
import {
  pushRecentAssignmentJump,
  readRecentAssignmentJumps,
  type RecentAssignmentJump,
} from '@/utils/work-order-recent-assignments';

interface StaffOption {
  id: number;
  name: string;
}

interface AssignmentDraft {
  techId: number | null;
  packerId: number | null;
  deadline: string;
}

export interface AssignmentConfirmPayload {
  techId: number | null;
  packerId: number | null;
  deadline: string | null;
  status?: WorkStatus;
}

export interface WorkOrderAssignmentCardProps {
  rows: WorkOrderRow[];
  startIndex: number;
  technicianOptions: StaffOption[];
  packerOptions: StaffOption[];
  onConfirm: (row: WorkOrderRow, payload: AssignmentConfirmPayload) => void;
  onClose: () => void;
  storageKey?: string;
  allowEditConfirmed?: boolean;
  closeWhenCompleted?: boolean;
}

function resolveTechTheme(staffId: number) {
  if (staffId === 1) return 'green';
  if (staffId === 2) return 'blue';
  if (staffId === 3) return 'purple';
  if (staffId === 6) return 'yellow';
  return getStaffThemeById(staffId, 'technician');
}

/** Plain text only (no chips): e.g. “Orders · Amazon”, “FBA”, or queue label. */
function assignmentHeaderContextText(row: WorkOrderRow): string {
  if (row.entityType === 'ORDER') {
    const orderKey = row.orderId ?? row.recordLabel;
    const channel = getOrderSourceTag(orderKey, row.accountSource);
    const platform = getOrderPlatformLabel(row.recordLabel, row.accountSource).trim();
    if (!platform) return channel || row.queueLabel;
    if (platform.toLowerCase() === channel.toLowerCase()) return channel;
    return `${channel} · ${platform}`;
  }
  return row.queueLabel;
}

function toDraft(row: WorkOrderRow): AssignmentDraft {
  return {
    techId: row.techId ?? null,
    packerId: row.packerId ?? null,
    deadline: toDateInputValue(row.deadlineAt ?? null),
  };
}

function isDraftComplete(row: WorkOrderRow, draft: AssignmentDraft): boolean {
  if (row.entityType === 'SKU_STOCK') return draft.techId != null;
  return draft.techId != null && draft.packerId != null;
}

function chipLabel(entry: RecentAssignmentJump): string {
  const raw = (entry.title || entry.queueLabel || entry.rowId).trim();
  if (raw.length <= 28) return raw;
  return `${raw.slice(0, 26)}…`;
}

export function WorkOrderAssignmentCard({
  rows,
  startIndex,
  technicianOptions,
  packerOptions,
  onConfirm,
  onClose,
  storageKey,
  allowEditConfirmed = false,
  closeWhenCompleted = true,
}: WorkOrderAssignmentCardProps) {
  const [index, setIndex] = useState(0);
  const confirmedIdsRef = useRef(new Set<string>());
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({});
  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentVersion, setRecentVersion] = useState(0);
  const [recentMissMessage, setRecentMissMessage] = useState<string | null>(null);

  const recentJumps = useMemo(() => readRecentAssignmentJumps(), [recentVersion]);

  const recordRecentAssignment = useCallback((r: WorkOrderRow, tech: number | null, pack: number | null) => {
    const title =
      (r.recordLabel && String(r.recordLabel).trim()) ||
      (r.title && String(r.title).trim()) ||
      (r.subtitle && String(r.subtitle).trim()) ||
      r.id;
    pushRecentAssignmentJump({
      rowId: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      title,
      queueLabel: r.queueLabel || '',
      techId: tech,
      packerId: pack,
    });
    setRecentVersion((v) => v + 1);
  }, []);

  const jumpToRecentRow = useCallback(
    (rowId: string) => {
      const i = rows.findIndex((r) => r.id === rowId);
      if (i < 0) {
        setRecentMissMessage('Not in this assign list');
        window.setTimeout(() => setRecentMissMessage(null), 2200);
        return;
      }
      setRecentMissMessage(null);
      setIndex(i);
    },
    [rows]
  );

  const cancelPendingDebouncedSave = useCallback(() => {
    if (saveDebounceTimerRef.current != null) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
  }, []);

  const row = rows[index];
  const [techId, setTechId] = useState<number | null>(null);
  const [packerId, setPackerId] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<string>('');

  useEffect(() => {
    const nextDrafts: Record<string, AssignmentDraft> = {};
    rows.forEach((r) => {
      nextDrafts[r.id] = toDraft(r);
    });

    let nextIndex = Math.max(0, Math.min(startIndex, Math.max(0, rows.length - 1)));
    let confirmedIds = new Set<string>();

    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            index?: number;
            assignments?: Record<string, Partial<AssignmentDraft>>;
            confirmedIds?: string[];
          };

          if (parsed.assignments && typeof parsed.assignments === 'object') {
            Object.entries(parsed.assignments).forEach(([rowId, saved]) => {
              if (!nextDrafts[rowId]) return;
              nextDrafts[rowId] = {
                techId: Number.isFinite(Number(saved.techId)) && Number(saved.techId) > 0 ? Number(saved.techId) : null,
                packerId: Number.isFinite(Number(saved.packerId)) && Number(saved.packerId) > 0 ? Number(saved.packerId) : null,
                deadline: typeof saved.deadline === 'string' ? saved.deadline : nextDrafts[rowId].deadline,
              };
            });
          }

          if (Number.isFinite(parsed.index)) {
            nextIndex = Math.max(0, Math.min(Number(parsed.index), Math.max(0, rows.length - 1)));
          }

          if (Array.isArray(parsed.confirmedIds)) {
            confirmedIds = new Set(
              parsed.confirmedIds.filter((id) => rows.some((r) => r.id === id))
            );
          }
        }
      } catch {
        // ignore malformed storage payloads
      }
    }

    setDrafts(nextDrafts);
    setIndex(nextIndex);
    confirmedIdsRef.current = confirmedIds;
    setConfirmedCount(confirmedIds.size);
  }, [rows, startIndex, storageKey]);

  const changed =
    techId !== (row?.techId ?? null) ||
    packerId !== (row?.packerId ?? null) ||
    deadline !== toDateInputValue(row?.deadlineAt ?? null);

  useEffect(() => {
    if (!row) return;
    const draft = drafts[row.id] || toDraft(row);
    setTechId(draft.techId);
    setPackerId(draft.packerId);
    setDeadline(draft.deadline);
  }, [index, drafts, row]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        index,
        assignments: drafts,
        confirmedIds: Array.from(confirmedIdsRef.current),
      }));
    } catch {
      // ignore storage write errors
    }
  }, [storageKey, index, drafts, confirmedCount]);

  const findNextIndex = useCallback((from: number, dir: 'next' | 'prev') => {
    if (allowEditConfirmed) {
      const next = dir === 'next' ? from + 1 : from - 1;
      return next >= 0 && next < rows.length ? next : null;
    }

    if (dir === 'next') {
      for (let i = from + 1; i < rows.length; i++) {
        if (!confirmedIdsRef.current.has(rows[i].id)) return i;
      }
      return null;
    }
    for (let i = from - 1; i >= 0; i--) {
      if (!confirmedIdsRef.current.has(rows[i].id)) return i;
    }
    return null;
  }, [allowEditConfirmed, rows, confirmedCount]);

  const advance = useCallback(() => {
    const next = findNextIndex(index, 'next');
    if (next !== null) {
      setTimeout(() => { setIndex(next); }, 300);
    } else if (closeWhenCompleted) {
      if (storageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // no-op
        }
      }
      setTimeout(onClose, 350);
    }
  }, [findNextIndex, index, closeWhenCompleted, storageKey, onClose]);

  const markConfirmed = useCallback((rowId: string) => {
    if (confirmedIdsRef.current.has(rowId)) return;
    confirmedIdsRef.current.add(rowId);
    setConfirmedCount((c) => c + 1);
  }, []);

  const save = useCallback((opts?: Partial<AssignmentConfirmPayload>) => {
    if (!row) return;
    onConfirm(row, {
      techId: opts?.techId !== undefined ? opts.techId : techId,
      packerId: opts?.packerId !== undefined ? opts.packerId : packerId,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
  }, [row, onConfirm, techId, packerId, deadline]);

  const commit = useCallback((opts?: Partial<AssignmentConfirmPayload>) => {
    if (!row) return;
    cancelPendingDebouncedSave();
    markConfirmed(row.id);
    const nextTech = opts?.techId !== undefined ? opts.techId : techId;
    const nextPack = opts?.packerId !== undefined ? opts.packerId : packerId;
    onConfirm(row, {
      techId: nextTech,
      packerId: nextPack,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
    recordRecentAssignment(row, nextTech, nextPack);
    advance();
  }, [
    row,
    onConfirm,
    techId,
    packerId,
    deadline,
    markConfirmed,
    advance,
    cancelPendingDebouncedSave,
    recordRecentAssignment,
  ]);

  useEffect(() => {
    if (!changed) return;
    cancelPendingDebouncedSave();
    saveDebounceTimerRef.current = setTimeout(() => {
      saveDebounceTimerRef.current = null;
      save();
    }, 450);
    return () => cancelPendingDebouncedSave();
  }, [techId, packerId, deadline, changed, save, cancelPendingDebouncedSave]);

  const navigate = useCallback((dir: 'next' | 'prev') => {
    const next = findNextIndex(index, dir);
    if (next === null) return;
    setIndex(next);
  }, [index, findNextIndex]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); navigate('next'); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigate('prev'); }
      if (e.key === 'Escape')     { onClose(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, onClose]);

  if (!row) return null;

  const currentDraft = drafts[row.id] || toDraft(row);
  const updateCurrentDraft = (next: Partial<AssignmentDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [row.id]: {
        techId: currentDraft.techId,
        packerId: currentDraft.packerId,
        deadline: currentDraft.deadline,
        ...next,
      },
    }));
  };

  const hasPrev = findNextIndex(index, 'prev') !== null;
  const hasNext = findNextIndex(index, 'next') !== null;
  const remaining = allowEditConfirmed
    ? rows.filter((r) => !isDraftComplete(r, drafts[r.id] || toDraft(r))).length
    : rows.filter((r) => !confirmedIdsRef.current.has(r.id)).length;

  const handleTech = (id: number) => {
    const next = techId === id ? null : id;
    setTechId(next);
    updateCurrentDraft({ techId: next });
    if (isDraftComplete(row, { techId: next, packerId, deadline })) {
      setTimeout(() => {
        if (!row) return;
        cancelPendingDebouncedSave();
        markConfirmed(row.id);
        onConfirm(row, { techId: next, packerId, deadline: deadline || null });
        recordRecentAssignment(row, next, packerId);
        advance();
      }, 350);
    }
  };

  const handlePacker = (id: number) => {
    const next = packerId === id ? null : id;
    setPackerId(next);
    updateCurrentDraft({ packerId: next });
    if (isDraftComplete(row, { techId, packerId: next, deadline })) {
      setTimeout(() => {
        if (!row) return;
        cancelPendingDebouncedSave();
        markConfirmed(row.id);
        onConfirm(row, { techId, packerId: next, deadline: deadline || null });
        recordRecentAssignment(row, techId, next);
        advance();
      }, 350);
    }
  };

  const handleMarkDone = () => commit({ status: 'DONE' });
  const handleMarkShipped = () => commit({ status: 'DONE', packerId: packerId ?? null });

  const topBar = (
    <Fragment>
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={() => navigate('prev')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20"
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">
          {remaining} remaining
        </span>
        <button
          type="button"
          disabled={!hasNext}
          onClick={() => navigate('next')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20"
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {recentJumps.length > 0 ? (
        <div className="border-t border-slate-100 px-3 pb-2.5 pt-1.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-slate-400">
            <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">Recent</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {recentJumps.map((entry) => {
              const inList = rows.some((r) => r.id === entry.rowId);
              const isCurrent = entry.rowId === row.id;
              return (
                <button
                  key={entry.rowId}
                  type="button"
                  title={entry.title}
                  disabled={!inList}
                  onClick={() => jumpToRecentRow(entry.rowId)}
                  className={[
                    'shrink-0 touch-manipulation rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                    isCurrent
                      ? 'border-blue-400 bg-blue-50 text-slate-900'
                      : inList
                        ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300',
                  ].join(' ')}
                >
                  <span className="block max-w-[140px] truncate text-[10px] font-bold leading-tight">
                    {chipLabel(entry)}
                  </span>
                  <span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-wide text-slate-400">
                    {inList ? 'Jump' : 'Not here'}
                  </span>
                </button>
              );
            })}
          </div>
          {recentMissMessage ? (
            <p className="mt-1.5 text-center text-[9px] font-bold uppercase tracking-wider text-amber-600">
              {recentMissMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </Fragment>
  );

  const headerEyebrow = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex min-h-[26px] min-w-0 flex-1 items-center">
        <span className="truncate text-[13px] font-black uppercase tracking-[0.08em] leading-none text-slate-500">
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
      widthClassName="w-[96vw] max-w-[780px] sm:w-[760px]"
      headerClassName="!py-2"
      dialogPosition="midAnchor"
      showHeaderGradient={false}
      bodyClassName="p-0"
      showCloseButton={false}
    >
      <div className="flex min-w-0 flex-col">
        <LayoutGroup id="work-order-assign-title">
          <div className="min-w-0 shrink-0 px-5 pb-2 pt-1">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={row.id}
                layout
                style={{ transformOrigin: '50% 100%' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={framerTransition.workOrderAssignmentTitleBlock}
                className="min-w-0"
              >
                <h2 className="break-words text-[22px] font-black leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere]">
                  {row.title}
                </h2>
              </motion.div>
            </AnimatePresence>
          </div>
        </LayoutGroup>

        <div className="shrink-0 space-y-4 border-t border-slate-100 px-5 pb-5 pt-2.5">
              <div>
                <p className="mb-2 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Technician</p>
                {technicianOptions.length > 0 ? (
                  <div
                    className="grid w-full gap-2"
                    style={{ gridTemplateColumns: `repeat(${Math.max(1, technicianOptions.length)}, minmax(0, 1fr))` }}
                  >
                    {technicianOptions.map((m) => {
                      const active = techId === m.id;
                      const cls = stationThemeClasses[resolveTechTheme(m.id)];
                      return (
                        <motion.button
                          key={m.id}
                          type="button"
                          whileTap={framerGesture.tapPress}
                          onClick={() => handleTech(m.id)}
                          className={[
                            'touch-manipulation flex h-11 w-full min-w-0 flex-col items-center justify-center rounded-lg border-2 px-2 transition-all active:scale-[0.98]',
                            active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                          ].join(' ')}
                        >
                          <span className="w-full text-center text-[10px] font-black uppercase leading-tight tracking-[0.04em]">
                            {m.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    No technicians
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2.5 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Packer</p>
                {packerOptions.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {packerOptions.map((m) => {
                      const active = packerId === m.id;
                      const cls = stationThemeClasses[getStaffThemeById(m.id, 'packer')];
                      return (
                        <motion.button
                          key={m.id}
                          type="button"
                          whileTap={framerGesture.tapPress}
                          onClick={() => handlePacker(m.id)}
                          className={[
                            'touch-manipulation flex h-11 w-full min-w-0 flex-col items-center justify-center rounded-lg border-2 px-2 transition-all active:scale-[0.98]',
                            active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                          ].join(' ')}
                        >
                          <span className="w-full text-center text-[10px] font-black uppercase leading-tight tracking-[0.04em]">
                            {m.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    No packers
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <span className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">
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
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-800 outline-none transition-colors focus:border-slate-400 tabular-nums"
                />
              </div>

              <div className={`grid gap-2 ${row.entityType === 'ORDER' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  type="button"
                  onClick={handleMarkDone}
                  className="h-8 rounded-lg border border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-[0.18em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                >
                  Mark as Done
                </button>
                {row.entityType === 'ORDER' && (
                  <button
                    type="button"
                    onClick={handleMarkShipped}
                    className="h-8 rounded-lg bg-emerald-600 text-[9px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-emerald-700 shadow-sm"
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
