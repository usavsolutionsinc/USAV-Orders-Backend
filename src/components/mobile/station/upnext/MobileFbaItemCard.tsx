'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresence,
  framerPresenceMobile,
  framerTransition,
  framerTransitionMobile,
  cardTitle,
  fieldLabel,
  chipText,
  dataValue,
  monoValue,
} from '@/design-system';
import { Check, ChevronDown, Copy, ExternalLink, Package, Settings } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { type FBAQueueItem } from '@/components/station/upnext/upnext-types';
import { TECH_IDS } from '@/utils/staff';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';

/* ── Helpers (same logic as desktop FbaItemCard) ────────────────────────────── */

interface StaffOption {
  id: number;
  name: string;
}

function getLast4(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return 'Not available';
  return raw.slice(-4);
}

function getAsinUrl(value: string | null | undefined) {
  const asin = String(value || '').trim();
  if (!asin) return null;
  return `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;
}

function getFbaConditionColor(condition: string | null | undefined) {
  const c = (condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}

function getConditionLabel(value: string | null | undefined) {
  const raw = String(value || '').trim();
  const normalized = raw.toUpperCase().replace(/\s+/g, ' ');
  if (!raw || normalized === 'FBA SCAN') return 'N/A';
  return raw.replaceAll('_', ' ');
}

function getDisplayFbaShipByDate(item: FBAQueueItem) {
  const deadlineRaw = String(item.deadline_at || '').trim();
  const dueRaw = String(item.due_date || '').trim();
  const isInvalid =
    !deadlineRaw ||
    /^\d+$/.test(deadlineRaw) ||
    Number.isNaN(new Date(deadlineRaw).getTime());
  return isInvalid ? dueRaw || null : deadlineRaw;
}

function getDaysLateNumber(deadlineAt: string | null | undefined, fallbackDate?: string | null) {
  const shipByKey = toPSTDateKey(deadlineAt) || toPSTDateKey(fallbackDate);
  const todayKey = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;
  const [sy, sm, sd] = shipByKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - shipByIndex);
}

function buildWorkOrderRow(item: FBAQueueItem): WorkOrderRow {
  return {
    id: `fba-shipment-${item.shipment_id}`,
    entityType: 'FBA_SHIPMENT',
    entityId: item.shipment_id,
    queueKey: 'fba_shipments',
    queueLabel: 'FBA Shipments',
    title: String(item.plan_title || item.shipment_ref || `Pending shipment #${item.shipment_id}`),
    subtitle: [item.fnsku, item.asin, item.sku].filter(Boolean).join(' \u2022 '),
    recordLabel: String(item.shipment_ref || `Row #${item.shipment_id}`),
    sourcePath: '/fba',
    techId: item.assigned_tech_id ?? null,
    techName: item.assigned_tech_name ?? null,
    packerId: item.assigned_packer_id ?? null,
    packerName: null,
    status: item.assigned_tech_id ? 'ASSIGNED' : 'OPEN',
    priority: 100,
    deadlineAt: String(item.deadline_at || item.due_date || '').trim() || null,
    notes: null,
    assignedAt: null,
    updatedAt: null,
  };
}

/* ── Props (same as desktop) ────────────────────────────────────────────────── */

interface MobileFbaItemCardProps {
  item: FBAQueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function MobileFbaItemCard({ item, isExpanded, onToggleExpand }: MobileFbaItemCardProps) {
  const [copiedAsin, setCopiedAsin] = useState(false);
  const [showAssignment, setShowAssignment] = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPackerOptions] = useState<StaffOption[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const displayShipBy = getDisplayFbaShipByDate(item);
  const daysLate = getDaysLateNumber(item.deadline_at, item.due_date);
  const qtyReady    = Number(item.actual_qty) || 0;
  const qtyExpected = Number(item.expected_qty) || 0;
  const qtyLabel = qtyExpected > 0 ? qtyExpected : qtyReady || 1;
  const fnsku = String(item.fnsku || '').trim();
  const asin = String(item.asin || '').trim();
  const asinUrl = getAsinUrl(asin);
  const conditionLabel = getConditionLabel(item.condition);
  const pendingTitle = String(item.plan_title || item.shipment_ref || '').trim();

  const handleCopyAsin = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!asin) return;
    try {
      await navigator.clipboard.writeText(asin);
      setCopiedAsin(true);
      window.setTimeout(() => setCopiedAsin(false), 1500);
    } catch {
      // noop
    }
  };

  const openAssignment = async (e: MouseEvent) => {
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
    } catch {
      // proceed with empty options
    }
    setShowAssignment(true);
  };

  const handleAssignConfirm = async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const newStatus =
      payload.status ??
      (payload.techId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);

    try {
      const res = await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: row.entityType,
          entityId: row.entityId,
          assignedTechId: payload.techId,
          assignedPackerId: payload.packerId,
          status: newStatus,
          priority: row.priority,
          deadlineAt: payload.deadline,
          notes: row.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || 'Failed to save');
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save assignment');
    }
  };

  return (
    <>
      <motion.div
        key={`fba-item-${item.item_id}`}
        initial={framerPresenceMobile.mobileCard.initial}
        animate={framerPresenceMobile.mobileCard.animate}
        exit={framerPresenceMobile.mobileCard.exit}
        transition={framerTransitionMobile.mobileCardMount}
        onClick={onToggleExpand}
        className={`rounded-2xl border mb-2 px-0 py-3 transition-colors relative ${
          isExpanded
            ? 'bg-white border-purple-500'
            : 'bg-white border-purple-300 active:border-purple-500'
        }`}
      >
        {/* -- Header -- */}
        <div className="flex items-center justify-between mb-4 px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={displayShipBy || ''}
              showPrefix={false}
              showYear={false}
              icon={Package}
              iconClassName="w-4 h-4 text-purple-600"
              textClassName="text-[15px] font-black text-blue-700"
              className=""
            />
            <span className="text-[15px] font-black tabular-nums text-blue-700">{daysLate}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-extrabold font-mono text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
              #{getLast4(fnsku)}
            </span>
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={framerTransition.upNextChevron}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-pink-200 text-pink-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(236,72,153,0.16)] active:scale-95 transition-transform"
            >
              <ChevronDown className="w-5 h-5" />
            </motion.span>
          </div>
        </div>

        {/* -- Body -- */}
        <div className="px-3">
          <h4 className="text-[17px] font-black text-gray-900 leading-tight">
            <InlineQtyPrefix quantity={qtyLabel} />
            <span className={getFbaConditionColor(item.condition)}>{conditionLabel}</span>
            {' '}{item.product_title || `FNSKU \u2022 ${getLast4(fnsku)}`}
          </h4>
        </div>

        {/* -- Expanded details -- */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-fba-item"
              {...framerPresence.collapseHeight}
              transition={framerTransition.upNextCollapse}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-purple-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-700">

                  {/* Pending Group */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Pending Group</div>
                    <div className="text-[12px] font-bold font-mono text-gray-900 normal-case tracking-normal break-words">
                      {pendingTitle || '\u2014'}
                    </div>
                  </div>

                  {/* Shipment row ID */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Shipment row ID</div>
                    <div className="text-[12px] font-bold text-gray-900 tabular-nums normal-case tracking-normal">
                      {item.shipment_id}
                    </div>
                  </div>

                  {/* ASIN */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">ASIN</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                        {asin || 'Not available'}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleCopyAsin}
                          disabled={!asin}
                          className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-purple-600 active:scale-95 transition-transform disabled:opacity-50"
                          aria-label={copiedAsin ? 'ASIN copied' : 'Copy ASIN'}
                        >
                          {copiedAsin ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (asinUrl) window.open(asinUrl, '_blank', 'noopener,noreferrer');
                          }}
                          disabled={!asinUrl}
                          className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-purple-600 active:scale-95 transition-transform disabled:opacity-50"
                          aria-label="Open ASIN in external tab"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Tech */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-bold text-gray-900 normal-case tracking-normal">
                        {item.assigned_tech_name || 'Unassigned'}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-purple-600 active:scale-95 transition-transform"
                        aria-label="Edit assignment"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* FNSKU */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">FNSKU</div>
                    <div className="text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                      {fnsku || 'Not available'}
                    </div>
                  </div>

                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Assignment overlay -- portal */}
      {mounted && createPortal(
        <AnimatePresence>
          {showAssignment && (
            <WorkOrderAssignmentCard
              rows={[buildWorkOrderRow(item)]}
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
