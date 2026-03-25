'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Settings } from '@/components/Icons';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/design-system/components';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { RepairQueueItem } from './upnext-types';
import { UpNextActionButton } from './UpNextActionButton';

const TECH_IDS = [1, 2, 3, 6];

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

function getRepairDisplayDate(repair: RepairQueueItem) {
  return repair.deadlineAt || repair.dateTime || null;
}

function getDaysLateNumber(deadlineAt: string | null | undefined, fallbackDate?: string | null) {
  const dueKey = toPSTDateKey(deadlineAt) || toPSTDateKey(fallbackDate);
  const todayKey = getCurrentPSTDateKey();
  if (!dueKey || !todayKey) return 0;
  const [dy, dm, dd] = dueKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const dueIndex = Math.floor(Date.UTC(dy, dm - 1, dd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - dueIndex);
}

function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

interface StaffOption { id: number; name: string; }

interface RepairCardProps {
  repair: RepairQueueItem;
  techId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRefresh?: () => void;
}

export function RepairCard({ repair, techId, isExpanded, onToggleExpand, onRefresh }: RepairCardProps) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const skuValue = String(repair.sku || '').trim();

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

  // Repaired / repair-outcome flow
  const [showRepairedInput, setShowRepairedInput] = useState(false);
  const [outcomeText, setOutcomeText]             = useState('');
  const [repairedSaving, setRepairedSaving]       = useState(false);

  const ticketShort    = repair.ticketNumber ? repair.ticketNumber.slice(-4) : '????';
  const customerName   = repair.contactInfo ? repair.contactInfo.split(',')[0]?.trim() : '';
  const customerPhone  = repair.contactInfo ? repair.contactInfo.split(',')[1]?.trim() : '';
  const daysLate       = getDaysLateNumber(repair.deadlineAt, repair.dateTime);
  const isUnassigned   = repair.assignedTechId === null;
  const hasOutOfStock  = !!repair.outOfStock;
  const hasOutcome     = !!repair.repairOutcome;
  // ── Assignment overlay ──────────────────────────────────────────────────────

  const openAssignment = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const members = await getPresentStaffForToday();
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

  const handleRepairedSubmit = async () => {
    if (!outcomeText.trim()) return;
    setRepairedSaving(true);
    try {
      const numericTechId = Number(techId);
      const resolvedTechId = Number.isFinite(numericTechId) && numericTechId > 0
        ? numericTechId
        : repair.assignedTechId;

      const res = await fetch('/api/repair-service/repaired', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId:          repair.repairId,
          assignmentId:      repair.assignmentId,
          repairedPart:      outcomeText.trim(),
          completedByTechId: resolvedTechId,
          assignedTechId:    repair.assignedTechId ?? resolvedTechId ?? null,
        }),
      });
      if (!res.ok) throw new Error('Failed to mark repaired');
      setShowRepairedInput(false);
      setOutcomeText('');
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to mark repair as repaired');
    } finally {
      setRepairedSaving(false);
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
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={onToggleExpand}
        className={`cursor-pointer border-b-2 px-0 py-2.5 transition-colors ${
          isUnassigned
            ? isExpanded ? 'border-orange-500 bg-white' : 'border-orange-400 bg-white hover:border-orange-500'
            : isExpanded ? 'border-orange-500 bg-white' : 'border-orange-300 bg-white hover:border-orange-500'
        }`}
      >
        {/* ── Header ── */}
        <div className="mb-3 flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={getRepairDisplayDate(repair)}
              showPrefix={false}
              showYear={false}
              icon={Settings}
              iconClassName="w-4 h-4 text-orange-600"
              textClassName="text-[14px] font-black text-blue-700"
              className=""
            />
            <span className={`text-[14px] font-black ${getDaysLateTone(daysLate)}`}>
              {daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PlatformExternalChip
              orderId={skuValue}
              accountSource={null}
              canOpen={!!getExternalUrlByItemNumber(skuValue)}
              onOpen={() => openExternalByItemNumber(skuValue)}
            />
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-orange-200 text-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(251,146,60,0.16)]"
            >
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <div className="mb-1 flex items-center justify-between gap-2">
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
          <div className="mt-2.5 border-t border-orange-100 px-3 pt-2">
            <p className="text-sm font-bold text-gray-700 leading-relaxed line-clamp-2">{repair.issue}</p>
          </div>
        )}

        {/* ── Compact action area (always visible) ── */}
        <div className="mt-2.5 border-t border-orange-100 px-3 pt-2" onClick={stopProp}>

          {/* Out-of-stock display */}
          {hasOutOfStock && (
            <OutOfStockField value={repair.outOfStock!} className="mb-2" />
          )}

          {/* Repair outcome display */}
          {hasOutcome && !hasOutOfStock && (
            <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-emerald-700">Repaired Part</span>
              <p className="text-sm text-gray-900 break-words leading-snug">{repair.repairOutcome}</p>
            </div>
          )}

          {/* Action buttons — hide when an input form is open */}
          {!showOosInput && !showRepairedInput && (
            <div className={`grid gap-2 ${!hasOutOfStock && !hasOutcome ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!hasOutOfStock && (
                <UpNextActionButton
                  onClick={(e) => { stopProp(e); setShowRepairedInput(false); setShowOosInput(true); }}
                  label="Out of Stock"
                  tone="red"
                  fullWidth
                />
              )}
              {!hasOutcome && (
                <UpNextActionButton
                  onClick={(e) => { stopProp(e); setShowOosInput(false); setShowRepairedInput(true); }}
                  label="Repaired"
                  icon={<Check className="w-3.5 h-3.5" />}
                  tone="emerald"
                  fullWidth
                />
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
                  autoFocus
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Repaired / repair-outcome input */}
          <AnimatePresence initial={false}>
            {showRepairedInput && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden pt-0.5"
              >
                <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
                  <textarea
                    value={outcomeText}
                    onChange={(e) => setOutcomeText(e.target.value)}
                    onClick={stopProp}
                    placeholder="What was repaired?"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-xs font-bold leading-relaxed text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus:outline-none focus:ring-2 focus:ring-emerald-400 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <UpNextActionButton
                      onClick={(e) => { stopProp(e); setShowRepairedInput(false); setOutcomeText(''); }}
                      label="Cancel"
                      tone="gray"
                      size="sm"
                      fullWidth
                    />
                    <UpNextActionButton
                      onClick={(e) => { stopProp(e); handleRepairedSubmit(); }}
                      disabled={repairedSaving}
                      label={repairedSaving ? 'Saving…' : 'Mark Repaired'}
                      tone="emerald"
                      size="sm"
                      fullWidth
                    />
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
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-orange-200 px-3 pt-2.5">
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Customer</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {customerName || 'Unknown'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Phone / Serial</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {customerPhone || repair.serialNumber || 'None'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Assigned Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                        {repair.techName || (isUnassigned ? 'Unassigned' : 'Unknown')}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 text-gray-400 hover:text-orange-600 transition-colors"
                        aria-label="Open work order assignment"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Repair ID</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {repair.repairId != null ? String(repair.repairId) : 'Unknown'}
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
