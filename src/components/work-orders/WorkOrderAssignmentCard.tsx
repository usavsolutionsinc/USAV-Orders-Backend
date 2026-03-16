'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';
import { getAccountSourceLabel } from '@/utils/order-links';
import { formatDate, toDateInputValue } from './types';
import type { WorkOrderRow, WorkStatus } from './types';

interface StaffOption {
  id: number;
  name: string;
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

const slideVariants = {
  enter: (dir: 'next' | 'prev') => ({ x: dir === 'next' ? '55%' : '-55%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: 'next' | 'prev') => ({ x: dir === 'next' ? '-55%' : '55%', opacity: 0 }),
};

const slideTransition = { type: 'spring' as const, damping: 28, stiffness: 380, mass: 0.42 };

export function WorkOrderAssignmentCard({
  rows,
  startIndex,
  technicianOptions,
  packerOptions,
  onConfirm,
  onClose,
}: WorkOrderAssignmentCardProps) {
  const [index, setIndex] = useState(() => Math.min(startIndex, rows.length - 1));
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  // Use a separate ref for mutation + counter state to drive re-renders
  const confirmedIdsRef = useRef(new Set<string>());
  const [confirmedCount, setConfirmedCount] = useState(0);

  const row = rows[index];
  const [techId, setTechId] = useState<number | null>(row?.techId ?? null);
  const [packerId, setPackerId] = useState<number | null>(row?.packerId ?? null);
  const [deadline, setDeadline] = useState<string>(() => toDateInputValue(row?.deadlineAt ?? null));

  const changed =
    techId !== (row?.techId ?? null) ||
    packerId !== (row?.packerId ?? null) ||
    deadline !== toDateInputValue(row?.deadlineAt ?? null);

  // Reset all local state when navigating to a different row
  useEffect(() => {
    if (row) {
      setTechId(row.techId ?? null);
      setPackerId(row.packerId ?? null);
      setDeadline(toDateInputValue(row.deadlineAt ?? null));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const findNextIndex = useCallback((from: number, dir: 'next' | 'prev') => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, confirmedCount]);

  const advance = useCallback(() => {
    const next = findNextIndex(index, 'next');
    if (next !== null) {
      setTimeout(() => { setDirection('next'); setIndex(next); }, 300);
    } else {
      setTimeout(onClose, 350);
    }
  }, [findNextIndex, index, onClose]);

  // Silent save — persists current state without navigating away.
  // Used by the auto-save debounce so that selecting tech then packer
  // with >450ms between taps doesn't accidentally advance to the next row.
  const save = useCallback((opts?: Partial<AssignmentConfirmPayload>) => {
    if (!row) return;
    onConfirm(row, {
      techId: opts?.techId !== undefined ? opts.techId : techId,
      packerId: opts?.packerId !== undefined ? opts.packerId : packerId,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
  }, [row, onConfirm, techId, packerId, deadline]);

  // Explicit confirm — marks item done in this session and advances to the next.
  const commit = useCallback((opts?: Partial<AssignmentConfirmPayload>) => {
    if (!row) return;
    confirmedIdsRef.current.add(row.id);
    setConfirmedCount((c) => c + 1);
    onConfirm(row, {
      techId: opts?.techId !== undefined ? opts.techId : techId,
      packerId: opts?.packerId !== undefined ? opts.packerId : packerId,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
    advance();
  }, [row, onConfirm, techId, packerId, deadline, advance]);

  // Auto-save on any staff/deadline change — silent only, never closes the card.
  // Commit (save + close) is handled directly inside handleTech/handlePacker below
  // so the new values are passed explicitly — no stale-closure risk.
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

  // Keyboard navigation
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

  const hasPrev = findNextIndex(index, 'prev') !== null;
  const hasNext = findNextIndex(index, 'next') !== null;
  // confirmedCount in the dep ensures this recomputes after each commit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const remaining = rows.filter((r) => !confirmedIdsRef.current.has(r.id)).length;

  const handleTech = (id: number) => {
    const next = techId === id ? null : id;
    setTechId(next);
    // If packer is already chosen, both slots are now filled → commit immediately.
    // Values are passed explicitly to avoid any stale-closure issues.
    if (next !== null && packerId !== null) {
      setTimeout(() => {
        if (!row) return;
        confirmedIdsRef.current.add(row.id);
        setConfirmedCount((c) => c + 1);
        onConfirm(row, { techId: next, packerId, deadline: deadline || null });
        advance();
      }, 350);
    }
  };

  const handlePacker = (id: number) => {
    const next = packerId === id ? null : id;
    setPackerId(next);
    // If tech is already chosen, both slots are now filled → commit immediately.
    if (techId !== null && next !== null) {
      setTimeout(() => {
        if (!row) return;
        confirmedIdsRef.current.add(row.id);
        setConfirmedCount((c) => c + 1);
        onConfirm(row, { techId, packerId: next, deadline: deadline || null });
        advance();
      }, 350);
    }
  };

  const handleMarkDone = () => commit({ status: 'DONE' });
  // Mark as Shipped: confirms the packing/shipping work is complete.
  // For ORDER entities the WA status becomes DONE (shipping state is derived
  // from carrier tracking numbers, not from this enum).
  const handleMarkShipped = () => commit({ status: 'DONE', packerId: packerId ?? null });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/35 backdrop-blur-[3px] z-[200]"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 8 }}
        transition={{ type: 'spring', damping: 26, stiffness: 400, mass: 0.4 }}
        style={{ position: 'fixed', top: '50%', left: '50%', translate: '-50% -50%' }}
        className="z-[201] w-[94vw] max-w-[460px] overflow-hidden rounded-2xl bg-white shadow-[0_32px_80px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nav bar */}
        <div className="flex items-center justify-between px-4 pt-4 pb-0">
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

        {/* Animated body */}
        <div className="overflow-hidden">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={row.id}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
            >
              {/* Header */}
              <div className="px-5 pt-3 pb-4">
                <p className="text-[9px] font-black uppercase tracking-[0.26em] text-emerald-600">
                  {getSourceLabel(row)}
                </p>
                <h3 className="mt-1.5 max-h-[5rem] overflow-y-auto text-[22px] font-black leading-[1.15] tracking-tight text-slate-950 scrollbar-hide">
                  {row.title}
                </h3>
                {row.subtitle && (
                  <p className="mt-1 line-clamp-1 text-[10px] font-medium text-slate-400 tabular-nums">
                    {formatSubtitle(row)}
                  </p>
                )}
              </div>

              <div className="mx-5 h-px bg-gray-100" />

              <div className="px-5 pb-5 pt-4 space-y-4">

                {/* Technician */}
                <div>
                  <p className="mb-2.5 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Technician</p>
                  <div className="grid grid-cols-4 gap-2">
                    {technicianOptions.map((m) => {
                      const active = techId === m.id;
                      const cls = stationThemeClasses[resolveTechTheme(m.id)];
                      return (
                        <motion.button
                          key={m.id}
                          type="button"
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleTech(m.id)}
                          className={[
                            'flex h-[64px] flex-col items-center justify-center rounded-xl border-2 transition-all',
                            active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                          ].join(' ')}
                        >
                          <span className="px-1 text-[10px] font-black uppercase tracking-wide leading-tight text-center">
                            {m.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Packer */}
                <div>
                  <p className="mb-2.5 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Packer</p>
                  <div className="flex flex-wrap gap-2">
                    {packerOptions.map((m) => {
                      const active = packerId === m.id;
                      const cls = stationThemeClasses[getStaffThemeById(m.id, 'packer')];
                      return (
                        <motion.button
                          key={m.id}
                          type="button"
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handlePacker(m.id)}
                          className={[
                            'flex h-14 min-w-[90px] flex-1 flex-col items-center justify-center rounded-xl border-2 px-4 transition-all',
                            active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                          ].join(' ')}
                        >
                          <span className="text-[10px] font-black uppercase tracking-wide leading-tight">
                            {m.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Deadline — editable */}
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <span className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">
                    Deadline
                  </span>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-800 outline-none focus:border-slate-400 transition-colors tabular-nums"
                  />
                </div>

                {/* Action buttons */}
                <div className={`grid gap-2 ${row.entityType === 'ORDER' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <button
                    type="button"
                    onClick={handleMarkDone}
                    className="h-10 rounded-xl border border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700 transition-colors hover:bg-slate-100 hover:border-slate-300"
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
      </motion.div>
    </>
  );
}
