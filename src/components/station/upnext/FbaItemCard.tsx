'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Copy, ExternalLink, Package, Settings } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/design-system/components';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { type FBAQueueItem } from './upnext-types';

const TECH_IDS = [1, 2, 3, 6];

interface StaffOption {
  id: number;
  name: string;
}

interface FbaItemCardProps {
  item: FBAQueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
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

function getConditionLabel(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return 'No Condition';
  return raw.replaceAll('_', ' ');
}

/** Prefer warehouse `deadline_at`; fall back to `due_date` when invalid (same idea as OrderCard ship_by / created). */
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
    title: String(item.plan_title || item.shipment_ref || `Shipment row #${item.shipment_id}`),
    subtitle: [item.fnsku, item.asin, item.sku].filter(Boolean).join(' • '),
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

export function FbaItemCard({ item, isExpanded, onToggleExpand }: FbaItemCardProps) {
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
  const planTitle = String(item.plan_title || item.shipment_ref || '').trim();

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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onToggleExpand}
        className={`border-b-2 px-0 py-3 transition-colors relative cursor-pointer ${
          isExpanded
            ? 'bg-white border-purple-500'
            : 'bg-white border-purple-300 hover:border-purple-500'
        }`}
      >
        <div className="flex items-center justify-between mb-4 px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={displayShipBy || ''}
              showPrefix={false}
              showYear={false}
              icon={Package}
              iconClassName="w-4 h-4 text-purple-600"
              textClassName="text-[14px] font-black text-blue-700"
              className=""
            />
            <span className="text-[14px] font-black tabular-nums text-blue-700">{daysLate}</span>
          </div>
          <div className="flex items-center gap-2">
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.18 }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-pink-200 text-pink-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(236,72,153,0.16)]"
            >
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </div>
        </div>

        <div className="px-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-black text-gray-900">{qtyLabel}</span>
              <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">-</span>
              <span className="text-[13px] font-black uppercase truncate text-gray-900">
                {conditionLabel}
              </span>
            </div>
            <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
              #{getLast4(fnsku)}
            </span>
          </div>
          <h4 className="text-base font-black text-gray-900 leading-tight">{item.product_title || `FNSKU • ${getLast4(fnsku)}`}</h4>
        </div>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-fba-item"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-purple-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Plan ID</div>
                    <div className="text-[11px] font-mono text-gray-900 normal-case tracking-normal break-words">
                      {planTitle || '—'}
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Shipment row ID</div>
                    <div className="text-[11px] tabular-nums text-gray-900 normal-case tracking-normal">
                      {item.shipment_id}
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">ASIN</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[11px] text-gray-900 normal-case tracking-normal break-words">
                        {asin || 'Not available'}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleCopyAsin}
                          disabled={!asin}
                          className="flex-shrink-0 text-gray-400 hover:text-purple-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={copiedAsin ? 'ASIN copied' : 'Copy ASIN'}
                        >
                          {copiedAsin ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (asinUrl) window.open(asinUrl, '_blank', 'noopener,noreferrer');
                          }}
                          disabled={!asinUrl}
                          className="flex-shrink-0 text-gray-400 hover:text-purple-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Open ASIN in external tab"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-gray-900 normal-case tracking-normal">
                        {item.assigned_tech_name || 'Unassigned'}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 text-gray-400 hover:text-purple-600 transition-colors"
                        aria-label="Edit assignment"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">FNSKU</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                      {fnsku || 'Not available'}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

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
