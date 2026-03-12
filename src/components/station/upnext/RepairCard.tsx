'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Play, Settings, Wrench } from '@/components/Icons';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { getActiveStaff } from '@/lib/staffCache';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { RepairQueueItem } from './upnext-types';

const TECH_IDS = [1, 2, 3, 6];

function getRepairAge(dateTime: string): string {
  if (!dateTime) return '';
  try {
    const parsed = typeof dateTime === 'string' && dateTime.startsWith('"') ? JSON.parse(dateTime) : dateTime;
    const dt = typeof parsed === 'object' && parsed?.start ? parsed.start : parsed;
    const ms = Date.now() - new Date(dt).getTime();
    const days = Math.floor(ms / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days}d ago`;
  } catch {
    return '';
  }
}

function buildWorkOrderRow(repair: RepairQueueItem): WorkOrderRow {
  return {
    id:           `repair-${repair.repairId}`,
    entityType:   'REPAIR',
    entityId:     repair.repairId,
    queueKey:     'repair_services',
    queueLabel:   'Repair Services',
    title:        repair.productTitle || 'Unknown Product',
    subtitle:     repair.ticketNumber || '',
    recordLabel:  repair.ticketNumber || '',
    sourcePath:   '/work-orders',
    techId:       repair.assignedTechId,
    techName:     repair.techName,
    packerId:     null,
    packerName:   null,
    status:       (repair.assignmentStatus as WorkOrderRow['status']) || 'OPEN',
    priority:     0,
    deadlineAt:   repair.deadlineAt,
    notes:        repair.issue || null,
    assignedAt:   null,
    updatedAt:    null,
  };
}

interface StaffOption { id: number; name: string; }

interface RepairCardProps {
  repair: RepairQueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRefresh?: () => void;
}

export function RepairCard({ repair, isExpanded, onToggleExpand, onRefresh }: RepairCardProps) {
  // Assignment overlay
  const [showAssignment, setShowAssignment] = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPakerOptions] = useState<StaffOption[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Out-of-stock flow
  const [showOosInput, setShowOosInput]     = useState(false);
  const [oosText, setOosText]               = useState('');
  const [oosSaving, setOosSaving]           = useState(false);

  // Start / repair-outcome flow
  const [showStartInput, setShowStartInput] = useState(false);
  const [outcomeText, setOutcomeText]       = useState('');
  const [startSaving, setStartSaving]       = useState(false);

  const ticketShort    = repair.ticketNumber ? repair.ticketNumber.slice(-4) : '????';
  const customerName   = repair.contactInfo ? repair.contactInfo.split(',')[0]?.trim() : '';
  const customerPhone  = repair.contactInfo ? repair.contactInfo.split(',')[1]?.trim() : '';
  const age            = getRepairAge(repair.deadlineAt || repair.dateTime);
  const isUnassigned   = repair.assignedTechId === null;
  const repairAgeLabel = age || 'Repair';
  const hasOutOfStock  = !!repair.outOfStock;
  const hasOutcome     = !!repair.repairOutcome;

  // ── Assignment overlay ──────────────────────────────────────────────────────

  const openAssignment = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const members = await getActiveStaff();
      setTechnicianOptions(
        members
          .filter((m) => m.role === 'technician' && TECH_IDS.includes(Number(m.id)))
          .map((m) => ({ id: Number(m.id), name: m.name }))
          .sort((a, b) => TECH_IDS.indexOf(a.id) - TECH_IDS.indexOf(b.id)),
      );
      setPakerOptions(
        members
          .filter((m) => m.role === 'packer')
          .map((m) => ({ id: Number(m.id), name: m.name })),
      );
    } catch { /* proceed with empty lists */ }
    setShowAssignment(true);
  };

  const handleAssignConfirm = async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const newStatus =
      payload.status ??
      (payload.techId && payload.packerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);
    try {
      const res = await fetch('/api/work-orders', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType:       row.entityType,
          entityId:         row.entityId,
          assignedTechId:   payload.techId,
          assignedPackerId: payload.packerId,
          status:           newStatus,
          priority:         row.priority,
          deadlineAt:       payload.deadline,
          notes:            row.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || 'Failed to save');
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save assignment');
    }
  };

  // ── Out-of-stock flow ───────────────────────────────────────────────────────

  const handleOosSubmit = async () => {
    if (!oosText.trim()) return;
    setOosSaving(true);
    try {
      const res = await fetch('/api/repair-service/out-of-stock', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId:     repair.repairId,
          assignmentId: repair.assignmentId,
          part:         oosText.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setShowOosInput(false);
      setOosText('');
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save out of stock');
    } finally {
      setOosSaving(false);
    }
  };

  // ── Start / outcome flow ────────────────────────────────────────────────────

  const handleStartSubmit = async () => {
    setStartSaving(true);
    try {
      const res = await fetch('/api/repair-service/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId:     repair.repairId,
          assignmentId: repair.assignmentId,
          outcome:      outcomeText.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to start');
      setShowStartInput(false);
      setOutcomeText('');
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to start repair');
    } finally {
      setStartSaving(false);
    }
  };

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <motion.div
        layout
        key={`repair-${repair.repairId}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        onClick={onToggleExpand}
        className={`border-b-2 px-0 py-3 transition-colors cursor-pointer ${
          isUnassigned
            ? isExpanded ? 'border-orange-500 bg-white' : 'border-orange-400 bg-white hover:border-orange-500'
            : isExpanded ? 'border-orange-500 bg-white' : 'border-orange-300 bg-white hover:border-orange-500'
        }`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4 px-3">
          <span className="inline-flex items-center gap-1 text-[14px] font-black text-gray-900">
            <Wrench className="w-4 h-4 text-orange-600" />
            {repairAgeLabel}
          </span>
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-orange-200 text-orange-500"
          >
            <ChevronDown className="w-4 h-4" />
          </motion.span>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-black text-gray-900">1</span>
            </div>
            <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
              #{ticketShort}
            </span>
          </div>
          <h4 className="text-base font-black text-gray-900 leading-tight">
            {repair.productTitle || 'Unknown Product'}
          </h4>
        </div>

        {/* ── Issue (always visible) ── */}
        {repair.issue && (
          <div className="mt-3 px-3 pt-2 border-t border-orange-100">
            <p className="text-sm font-bold text-gray-700 leading-relaxed line-clamp-2">{repair.issue}</p>
          </div>
        )}

        {/* ── Compact action area (always visible) ── */}
        <div className="mt-3 px-3 pt-2 border-t border-orange-100" onClick={stopProp}>

          {/* Out-of-stock display */}
          {hasOutOfStock && (
            <OutOfStockField value={repair.outOfStock!} className="mb-2" />
          )}

          {/* Repair outcome display */}
          {hasOutcome && !hasOutOfStock && (
            <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2">
              <span className="text-[10px] text-emerald-700 font-black uppercase tracking-widest block mb-1">Started</span>
              <p className="text-sm text-gray-900 break-words leading-snug">{repair.repairOutcome}</p>
            </div>
          )}

          {/* Action buttons — hide when an input form is open */}
          {!showOosInput && !showStartInput && (
            <div className="flex items-center gap-2">
              {!hasOutOfStock && (
                <button
                  onClick={(e) => { stopProp(e); setShowStartInput(false); setShowOosInput(true); }}
                  className="flex-1 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
                >
                  Out of Stock
                </button>
              )}
              {!hasOutcome && (
                <button
                  onClick={(e) => { stopProp(e); setShowOosInput(false); setShowStartInput(true); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-md shadow-emerald-600/20"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start
                </button>
              )}
            </div>
          )}

          {/* Out-of-stock input */}
          <AnimatePresence initial={false}>
            {showOosInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <OutOfStockField
                  editable
                  value={oosText}
                  onChange={setOosText}
                  onCancel={() => { setShowOosInput(false); setOosText(''); }}
                  onSubmit={handleOosSubmit}
                  isSaving={oosSaving}
                  autoFocus
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Start / repair-outcome input */}
          <AnimatePresence initial={false}>
            {showStartInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={outcomeText}
                    onChange={(e) => setOutcomeText(e.target.value)}
                    onClick={stopProp}
                    placeholder="Describe what you're repairing…"
                    className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-400 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { stopProp(e); setShowStartInput(false); setOutcomeText(''); }}
                      className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => { stopProp(e); handleStartSubmit(); }}
                      disabled={startSaving}
                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                    >
                      {startSaving ? 'Starting…' : 'Start Repair'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Expanded details ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-repair"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-orange-200 px-3 pt-3">
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  <div className="rounded-xl bg-orange-50 px-3 py-2">
                    <div className="mb-1 text-orange-400">Customer</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {customerName || 'Unknown'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-orange-50 px-3 py-2">
                    <div className="mb-1 text-orange-400">Phone / Serial</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {customerPhone || repair.serialNumber || 'None'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-orange-50 px-3 py-2">
                    <div className="mb-1 text-orange-400">Assigned Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                        {repair.techName || (isUnassigned ? 'Unassigned' : 'Unknown')}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 text-orange-400 hover:text-orange-600 transition-colors"
                        aria-label="Open work order assignment"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl bg-orange-50 px-3 py-2">
                    <div className="mb-1 text-orange-400">Ticket</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {repair.ticketNumber || 'Unknown'}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Assignment overlay — rendered via portal to escape any transform stacking
          context created by framer-motion's layout animations in ancestor elements */}
      {mounted && createPortal(
        <AnimatePresence>
          {showAssignment && (
            <WorkOrderAssignmentCard
              rows={[buildWorkOrderRow(repair)]}
              startIndex={0}
              technicianOptions={technicianOptions}
              packerOptions={packerOptions}
              onConfirm={handleAssignConfirm}
              onClose={() => setShowAssignment(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
