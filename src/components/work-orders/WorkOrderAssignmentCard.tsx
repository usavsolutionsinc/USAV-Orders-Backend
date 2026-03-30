'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';
import { getOrderPlatformLabel, getOrderSourceTag } from '@/utils/order-platform';
import { AssignmentOverlayCard } from '@/design-system/components/AssignmentOverlayCard';
import { framerGesture, framerTransition, framerPresence } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, microBadge } from '@/design-system/tokens/typography/presets';
import { WorkOrderInfoChips } from './WorkOrderInfoStrip';
import { toDateInputValue, type WorkOrderRow, type WorkStatus } from './types';

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
  return getStaffThemeById(staffId);
}

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

function isRowNeedingAssignment(row: WorkOrderRow): boolean {
  if (row.status === 'DONE' || row.status === 'CANCELED') return false;
  if (row.entityType === 'SKU_STOCK') return row.techId == null;
  return row.techId == null || row.packerId == null;
}

function isRowUnassigned(row: WorkOrderRow): boolean {
  if (row.entityType === 'SKU_STOCK') return row.techId == null;
  return row.techId == null && row.packerId == null;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : Number.NEGATIVE_INFINITY;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toRowDateKey(value: string | null | undefined): string | null {
  const stamp = toTimestamp(value);
  if (!Number.isFinite(stamp)) return null;
  return toLocalDateKey(new Date(stamp));
}

function compareRowsByUpdatedAtDesc(a: WorkOrderRow, b: WorkOrderRow): number {
  const updatedDiff = toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);
  if (updatedDiff !== 0) return updatedDiff;

  const createdDiff = toTimestamp(b.createdAt ?? null) - toTimestamp(a.createdAt ?? null);
  if (createdDiff !== 0) return createdDiff;

  return b.entityId - a.entityId;
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

  const orderedRows = useMemo(() => [...rows].sort(compareRowsByUpdatedAtDesc), [rows]);
  const assignableRows = useMemo(
    () => orderedRows.filter((r) => isRowNeedingAssignment(r)),
    [orderedRows]
  );

  const todayDateKey = useMemo(() => toLocalDateKey(new Date()), []);
  const todayTotalCount = useMemo(
    () => orderedRows.filter((r) => toRowDateKey(r.createdAt ?? null) === todayDateKey).length,
    [orderedRows, todayDateKey]
  );
  const todayUnassignedCount = useMemo(
    () => orderedRows.filter((r) => toRowDateKey(r.createdAt ?? null) === todayDateKey && isRowUnassigned(r)).length,
    [orderedRows, todayDateKey]
  );

  const cancelPendingDebouncedSave = useCallback(() => {
    if (saveDebounceTimerRef.current != null) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
  }, []);

  const row = assignableRows[index];
  const [techId, setTechId] = useState<number | null>(null);
  const [packerId, setPackerId] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<string>('');

  useEffect(() => {
    if (!assignableRows.length) {
      onClose();
    }
  }, [assignableRows.length, onClose]);

  useEffect(() => {
    const nextDrafts: Record<string, AssignmentDraft> = {};
    assignableRows.forEach((r) => {
      nextDrafts[r.id] = toDraft(r);
    });

    let nextIndex = 0;
    let confirmedIds = new Set<string>();

    const safeStartIndex = Math.max(0, Math.min(startIndex, Math.max(0, rows.length - 1)));
    const startRowId = rows[safeStartIndex]?.id;
    if (startRowId) {
      const mapped = assignableRows.findIndex((r) => r.id === startRowId);
      if (mapped >= 0) nextIndex = mapped;
    }

    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            index?: number;
            rowId?: string;
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

          if (typeof parsed.rowId === 'string' && parsed.rowId.trim()) {
            const byId = assignableRows.findIndex((r) => r.id === parsed.rowId);
            if (byId >= 0) nextIndex = byId;
          } else if (Number.isFinite(parsed.index)) {
            nextIndex = Math.max(0, Math.min(Number(parsed.index), Math.max(0, assignableRows.length - 1)));
          }

          if (Array.isArray(parsed.confirmedIds)) {
            const validRowIds = new Set(assignableRows.map((r) => r.id));
            confirmedIds = new Set(parsed.confirmedIds.filter((id) => validRowIds.has(id)));
          }
        }
      } catch {
        // ignore malformed storage payloads
      }
    }

    nextIndex = Math.max(0, Math.min(nextIndex, Math.max(0, assignableRows.length - 1)));

    if (!allowEditConfirmed && assignableRows.length > 0 && confirmedIds.has(assignableRows[nextIndex]?.id)) {
      let resolvedIndex: number | null = null;

      for (let i = nextIndex + 1; i < assignableRows.length; i++) {
        if (!confirmedIds.has(assignableRows[i].id)) {
          resolvedIndex = i;
          break;
        }
      }
      if (resolvedIndex === null) {
        for (let i = nextIndex - 1; i >= 0; i--) {
          if (!confirmedIds.has(assignableRows[i].id)) {
            resolvedIndex = i;
            break;
          }
        }
      }
      nextIndex = resolvedIndex ?? 0;
    }

    setDrafts(nextDrafts);
    setIndex(nextIndex);
    confirmedIdsRef.current = confirmedIds;
    setConfirmedCount(confirmedIds.size);
  }, [assignableRows, rows, startIndex, storageKey, allowEditConfirmed]);

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
        rowId: row?.id ?? null,
        assignments: drafts,
        confirmedIds: Array.from(confirmedIdsRef.current),
      }));
    } catch {
      // ignore storage write errors
    }
  }, [storageKey, index, row?.id, drafts, confirmedCount]);

  const findNextIndex = useCallback((from: number, dir: 'next' | 'prev') => {
    if (allowEditConfirmed) {
      const next = dir === 'next' ? from + 1 : from - 1;
      return next >= 0 && next < assignableRows.length ? next : null;
    }

    if (dir === 'next') {
      for (let i = from + 1; i < assignableRows.length; i++) {
        if (!confirmedIdsRef.current.has(assignableRows[i].id)) return i;
      }
      return null;
    }
    for (let i = from - 1; i >= 0; i--) {
      if (!confirmedIdsRef.current.has(assignableRows[i].id)) return i;
    }
    return null;
  }, [allowEditConfirmed, assignableRows, confirmedCount]);

  const advance = useCallback(() => {
    const next = findNextIndex(index, 'next');
    if (next !== null) {
      setTimeout(() => { setIndex(next); }, 300);
      return;
    }

    const prev = findNextIndex(index, 'prev');
    if (prev !== null) {
      setTimeout(() => { setIndex(prev); }, 300);
      return;
    }

    if (closeWhenCompleted) {
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
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigate('next');
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigate('prev');
      }
      if (e.key === 'Escape') {
        onClose();
      }
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
    ? assignableRows.filter((r) => !isDraftComplete(r, drafts[r.id] || toDraft(r))).length
    : assignableRows.filter((r) => !confirmedIdsRef.current.has(r.id)).length;

  const handleTech = (id: number) => {
    const next = techId === id ? null : id;
    setTechId(next);
    updateCurrentDraft({ techId: next });
    if (isDraftComplete(row, { techId: next, packerId, deadline })) {
      setTimeout(() => {
        cancelPendingDebouncedSave();
        markConfirmed(row.id);
        onConfirm(row, { techId: next, packerId, deadline: deadline || null });
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
        cancelPendingDebouncedSave();
        markConfirmed(row.id);
        onConfirm(row, { techId, packerId: next, deadline: deadline || null });
        advance();
      }, 350);
    }
  };

  const handleMarkDone = () => commit({ status: 'DONE' });
  const handleMarkShipped = () => commit({ status: 'DONE', packerId: packerId ?? null });

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
        <p className={`${sectionLabel} tracking-[0.22em]`}>
          {remaining} remaining
        </p>
        <p className={`mt-0.5 ${microBadge} tracking-[0.16em] text-gray-500`}>
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
        <span className="truncate text-[13px] font-black uppercase tracking-[0.08em] leading-none text-gray-500">
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
              {...framerPresence.tableRow}
              transition={framerTransition.overlayScrim}
              className="break-words text-[22px] font-black leading-tight tracking-tight text-gray-900 [overflow-wrap:anywhere]"
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
            <p className={`mb-2 ${sectionLabel}`}>Technician</p>
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
              <p className={fieldLabel}>
                No technicians
              </p>
            )}
          </div>

          <div>
            <p className={`mb-2.5 ${sectionLabel}`}>Packer</p>
            {packerOptions.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {packerOptions.map((m) => {
                  const active = packerId === m.id;
                  const cls = stationThemeClasses[getStaffThemeById(m.id)];
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
              <p className={fieldLabel}>
                No packers
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <span className={sectionLabel}>
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
              className={`rounded-md border border-gray-200 bg-white px-2 py-1 ${fieldLabel} text-gray-800 outline-none transition-colors focus:border-gray-400 tabular-nums`}
            />
          </div>

          <div className={`grid gap-2 ${row.entityType === 'ORDER' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              onClick={handleMarkDone}
              className={`h-8 rounded-lg border border-gray-200 bg-gray-50 ${sectionLabel} text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100`}
            >
              Mark as Done
            </button>
            {row.entityType === 'ORDER' && (
              <button
                type="button"
                onClick={handleMarkShipped}
                className={`h-8 rounded-lg bg-emerald-600 ${sectionLabel} text-white transition-colors hover:bg-emerald-700 shadow-sm`}
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
