'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';
import { getAccountSourceLabel } from '@/utils/order-links';
import { toDateInputValue, type WorkOrderRow, type WorkStatus } from '@/components/work-orders/types';
import { AssignmentOverlayCard } from './AssignmentOverlayCard';
import {
  framerGesture,
  framerTransition,
  workOrderAssignmentSlideVariants,
} from '../foundations/motion-framer';

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

function getSourceLabel(row: WorkOrderRow): string {
  if (row.entityType === 'ORDER') {
    const platform = getAccountSourceLabel(row.recordLabel, null);
    return platform ? `${row.queueLabel} · ${platform}` : row.queueLabel;
  }
  return row.queueLabel;
}

function formatSubtitle(row: WorkOrderRow): string {
  if (row.entityType === 'ORDER' && row.subtitle) {
    const [orderIdPart, trackingPart, skuPart] = row.subtitle.split(' • ');
    const pieces: string[] = [];
    if (orderIdPart) pieces.push(`#${orderIdPart.trim().slice(-4)}`);
    if (trackingPart) pieces.push(trackingPart.trim().slice(-4));
    if (skuPart) pieces.push(skuPart.trim());
    return pieces.join(' · ');
  }
  return row.subtitle || '';
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
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const confirmedIdsRef = useRef(new Set<string>());
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({});

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
      setTimeout(() => { setDirection('next'); setIndex(next); }, 300);
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
    markConfirmed(row.id);
    onConfirm(row, {
      techId: opts?.techId !== undefined ? opts.techId : techId,
      packerId: opts?.packerId !== undefined ? opts.packerId : packerId,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
    advance();
  }, [row, onConfirm, techId, packerId, deadline, markConfirmed, advance]);

  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => save(), 450);
    return () => clearTimeout(timer);
  }, [techId, packerId, deadline, changed, save]);

  const navigate = useCallback((dir: 'next' | 'prev') => {
    const next = findNextIndex(index, dir);
    if (next === null) return;
    setDirection(dir);
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
        if (!row) return;
        markConfirmed(row.id);
        onConfirm(row, { techId, packerId: next, deadline: deadline || null });
        advance();
      }, 350);
    }
  };

  const handleMarkDone = () => commit({ status: 'DONE' });
  const handleMarkShipped = () => commit({ status: 'DONE', packerId: packerId ?? null });
  const handleClearStaff = () => {
    setTechId(null);
    setPackerId(null);
    updateCurrentDraft({ techId: null, packerId: null });
  };
  const titleNode = (
    <span className="block max-h-[2.35em] overflow-y-auto pr-1 leading-[1.15]">
      {row.title}
    </span>
  );

  return (
    <AssignmentOverlayCard
      title={titleNode}
      subtitle={row.subtitle ? formatSubtitle(row) : undefined}
      onClose={onClose}
      widthClassName="w-[96vw] max-w-[780px] sm:w-[760px]"
      showHeaderGradient={false}
      bodyClassName="p-0"
      showCloseButton={false}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
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

      <div className="overflow-visible">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={row.id}
            custom={direction}
            variants={workOrderAssignmentSlideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={framerTransition.workOrderSlideSpring}
          >
            <div className="px-5 pt-3 pb-2">
              <p className="text-[9px] font-black uppercase tracking-[0.26em] text-emerald-600">
                {getSourceLabel(row)}
              </p>
            </div>

            <div className="mx-5 h-px bg-gray-100" />

            <div className="space-y-4 px-5 pb-5 pt-4">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">
                  Showing staff scheduled for today
                </p>
                <button
                  type="button"
                  onClick={handleClearStaff}
                  className="touch-manipulation rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
                >
                  Clear Staff
                </button>
              </div>

              <div>
                <p className="mb-2.5 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Technician</p>
                {technicianOptions.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                            'touch-manipulation flex h-[112px] w-full min-w-0 flex-col items-center justify-center rounded-2xl border-2 px-5 transition-all active:scale-[0.98]',
                            active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                          ].join(' ')}
                        >
                          <span className="w-full text-center text-[13px] font-black uppercase leading-tight tracking-[0.04em]">
                            {m.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    No technicians scheduled today
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
                            'touch-manipulation flex h-[112px] w-full min-w-0 flex-col items-center justify-center rounded-2xl border-2 px-5 transition-all active:scale-[0.98]',
                            active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                          ].join(' ')}
                        >
                          <span className="w-full text-center text-[13px] font-black uppercase leading-tight tracking-[0.04em]">
                            {m.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    No packers scheduled today
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
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-800 outline-none transition-colors focus:border-slate-400 tabular-nums"
                />
              </div>

              <div className={`grid gap-2 ${row.entityType === 'ORDER' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  type="button"
                  onClick={handleMarkDone}
                  className="h-10 rounded-xl border border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                >
                  Mark as Done
                </button>
                {row.entityType === 'ORDER' && (
                  <button
                    type="button"
                    onClick={handleMarkShipped}
                    className="h-10 rounded-xl bg-emerald-600 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-emerald-700 shadow-sm"
                  >
                    Mark as Shipped
                  </button>
                )}
              </div>

            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </AssignmentOverlayCard>
  );
}
