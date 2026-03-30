'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  framerPresence,
  framerPresenceMobile,
  framerTransition,
  framerTransitionMobile,
  cardTitle,
  fieldLabel,
  dataValue,
  chipText,
} from '@/design-system';
import { Check, ChevronDown, Settings } from '@/components/Icons';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { RepairQueueItem } from '@/components/station/upnext/upnext-types';
import { UpNextActionButton } from '@/components/station/upnext/UpNextActionButton';
import { TECH_IDS } from '@/utils/staff';

/* ── Helpers (same logic as desktop RepairCard) ─────────────────────────────── */

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

/* ── Props (same as desktop) ────────────────────────────────────────────────── */

interface MobileRepairCardProps {
  repair: RepairQueueItem;
  techId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRefresh?: () => void;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function MobileRepairCard({ repair, techId, isExpanded, onToggleExpand, onRefresh }: MobileRepairCardProps) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const skuValue = String(repair.sku || '').trim();

  // Assignment overlay
  const [showAssignment, setShowAssignment] = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPackerOptions] = useState<StaffOption[]>([]);
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

  // -- Assignment overlay --

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
      setPackerOptions(
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

  // -- Out-of-stock flow --

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

  // -- Start / outcome flow --

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
        initial={framerPresenceMobile.mobileCard.initial}
        animate={framerPresenceMobile.mobileCard.animate}
        exit={framerPresenceMobile.mobileCard.exit}
        transition={framerTransitionMobile.mobileCardMount}
        onClick={onToggleExpand}
        className={`rounded-2xl border mb-2 px-0 py-2.5 transition-colors ${
          isUnassigned
            ? isExpanded ? 'border-orange-500 bg-white' : 'border-orange-400 bg-white active:border-orange-500'
            : isExpanded ? 'border-orange-500 bg-white' : 'border-orange-300 bg-white active:border-orange-500'
        }`}
      >
        {/* -- Header -- */}
        <div className="mb-3 flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={getRepairDisplayDate(repair)}
              showPrefix={false}
              showYear={false}
              icon={Settings}
              iconClassName="w-4 h-4 text-orange-600"
              textClassName="text-[15px] font-black text-blue-700"
              className=""
            />
            <span className={`text-[15px] font-black ${getDaysLateTone(daysLate)}`}>
              {daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-extrabold font-mono text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
              #{ticketShort}
            </span>
            <PlatformExternalChip
              orderId={skuValue}
              accountSource={null}
              canOpen={!!getExternalUrlByItemNumber(skuValue)}
              onOpen={() => openExternalByItemNumber(skuValue)}
            />
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={framerTransition.upNextChevron}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-orange-200 text-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(251,146,60,0.16)] active:scale-95 transition-transform"
            >
              <ChevronDown className="w-5 h-5" />
            </motion.span>
          </div>
        </div>

        {/* -- Body -- */}
        <div className="px-3">
          <h4 className="text-[17px] font-black text-gray-900 leading-tight">
            {repair.productTitle || 'Unknown Product'}
          </h4>
        </div>

        {/* -- Issue (always visible) -- */}
        {repair.issue && (
          <div className="mt-2.5 border-t border-orange-100 px-3 pt-2">
            <p className="text-[15px] font-bold text-gray-700 leading-relaxed line-clamp-2">{repair.issue}</p>
          </div>
        )}

        {/* -- Compact action area (always visible) -- */}
        <div className="mt-2.5 border-t border-orange-100 px-3 pt-2" onClick={stopProp}>

          {/* Out-of-stock display */}
          {hasOutOfStock && (
            <OutOfStockField value={repair.outOfStock!} className="mb-2" />
          )}

          {/* Repair outcome display */}
          {hasOutcome && !hasOutOfStock && (
            <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-widest text-emerald-700">Repaired Part</span>
              <p className="text-[15px] text-gray-900 break-words leading-snug">{repair.repairOutcome}</p>
            </div>
          )}

          {/* Action buttons -- hide when an input form is open */}
          {!showOosInput && !showRepairedInput && (
            <div className={`grid gap-3 ${!hasOutOfStock && !hasOutcome ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!hasOutOfStock && (
                <UpNextActionButton
                  onClick={(e) => { stopProp(e); setShowRepairedInput(false); setShowOosInput(true); }}
                  label="Out of Stock"
                  tone="red"
                  fullWidth
                  className="min-h-[48px]"
                />
              )}
              {!hasOutcome && (
                <UpNextActionButton
                  onClick={(e) => { stopProp(e); setShowOosInput(false); setShowRepairedInput(true); }}
                  label="Repaired"
                  icon={<Check className="w-4 h-4" />}
                  tone="emerald"
                  fullWidth
                  className="min-h-[48px]"
                />
              )}
            </div>
          )}

          {/* Out-of-stock input */}
          <AnimatePresence initial={false}>
            {showOosInput && (
              <motion.div
                {...framerPresence.collapseHeight}
                transition={framerTransition.upNextCollapse}
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
                {...framerPresence.upNextRow}
                transition={framerTransition.upNextRowMount}
                className="overflow-hidden pt-0.5"
              >
                <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
                  <textarea
                    value={outcomeText}
                    onChange={(e) => setOutcomeText(e.target.value)}
                    onClick={stopProp}
                    placeholder="What was repaired?"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-[13px] font-bold leading-relaxed text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus:outline-none focus:ring-2 focus:ring-emerald-400 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <UpNextActionButton
                      onClick={(e) => { stopProp(e); setShowRepairedInput(false); setOutcomeText(''); }}
                      label="Cancel"
                      tone="gray"
                      size="sm"
                      fullWidth
                      className="min-h-[48px]"
                    />
                    <UpNextActionButton
                      onClick={(e) => { stopProp(e); handleRepairedSubmit(); }}
                      disabled={repairedSaving}
                      label={repairedSaving ? 'Saving\u2026' : 'Mark Repaired'}
                      tone="emerald"
                      size="sm"
                      fullWidth
                      className="min-h-[48px]"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* -- Expanded details -- */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-repair"
              {...framerPresence.collapseHeight}
              transition={framerTransition.upNextCollapse}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-orange-200 px-3 pt-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-700">
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Customer</div>
                    <div className="text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                      {customerName || 'Unknown'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Phone / Serial</div>
                    <div className="text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                      {customerPhone || repair.serialNumber || 'None'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Assigned Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                        {repair.techName || (isUnassigned ? 'Unassigned' : 'Unknown')}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-orange-600 active:scale-95 transition-transform"
                        aria-label="Open work order assignment"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Repair ID</div>
                    <div className="text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                      {repair.repairId != null ? String(repair.repairId) : 'Unknown'}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Assignment overlay -- rendered via portal to escape transform stacking context */}
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
