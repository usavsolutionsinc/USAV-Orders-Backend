'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Play, Settings } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getActiveStaff } from '@/lib/staffCache';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { Order } from './upnext-types';

const TECH_IDS = [1, 2, 3, 6];

interface StaffOption { id: number; name: string; }

function buildWorkOrderRow(order: Order): WorkOrderRow {
  return {
    id:          `order-${order.id}`,
    entityType:  'ORDER',
    entityId:    order.id,
    queueKey:    'orders',
    queueLabel:  'Orders',
    title:       order.product_title || 'Unknown Product',
    subtitle:    [order.order_id, order.shipping_tracking_number, order.sku].filter(Boolean).join(' • '),
    recordLabel: order.order_id || '',
    sourcePath:  '/work-orders',
    techId:      order.tester_id ?? null,
    techName:    order.tester_name ?? null,
    packerId:    null,
    packerName:  null,
    status:      'OPEN',
    priority:    0,
    deadlineAt:  order.ship_by_date ?? null,
    notes:       null,
    assignedAt:  null,
    updatedAt:   null,
  };
}

function getOrderIdLast4(orderId: string) {
  const digits = String(orderId || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(orderId || '').slice(-4);
}

function getDisplayShipByDate(order: Order) {
  const shipByRaw    = String(order.ship_by_date || '').trim();
  const createdAtRaw = String(order.created_at || '').trim();
  const isInvalid    = !shipByRaw || /^\d+$/.test(shipByRaw) || Number.isNaN(new Date(shipByRaw).getTime());
  return isInvalid ? createdAtRaw || null : shipByRaw;
}

function getDaysLateNumber(shipByDate: string | null | undefined, fallbackDate?: string | null) {
  const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
  const todayKey  = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;
  const [sy, sm, sd] = shipByKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
  const todayIndex  = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - shipByIndex);
}

function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

function AssignmentChip({ tester_id }: { tester_id?: number | null }) {
  if (tester_id != null) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-50 border border-amber-200 text-amber-600 leading-none">
      <span className="w-1 h-1 rounded-full bg-amber-400 inline-block" />
      Open
    </span>
  );
}

interface OrderCardProps {
  order: Order;
  effectiveTab: string;
  techId: string;
  showMissingPartsInput: number | null;
  missingPartsReason: string;
  onStart: (order: Order) => void;
  onMissingPartsToggle: (orderId: number) => void;
  onMissingPartsReasonChange: (reason: string) => void;
  onMissingPartsSubmit: (orderId: number) => void;
  onMissingPartsCancel: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function OrderCard({
  order,
  effectiveTab,
  techId,
  showMissingPartsInput,
  missingPartsReason,
  onStart,
  onMissingPartsToggle,
  onMissingPartsReasonChange,
  onMissingPartsSubmit,
  onMissingPartsCancel,
  isExpanded,
  onToggleExpand,
}: OrderCardProps) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();

  // Assignment overlay
  const [showAssignment, setShowAssignment]       = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPackerOptions]         = useState<StaffOption[]>([]);
  const [mounted, setMounted]                     = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const showActions   = effectiveTab !== 'stock';
  const isStockTab    = effectiveTab === 'stock';
  const hasOutOfStock = String(order.out_of_stock || '').trim() !== '';
  const quantity      = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  const daysLate      = getDaysLateNumber(order.ship_by_date, order.created_at);

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
      (payload.techId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);
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
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save assignment');
    }
  };

  return (
    <>
      <motion.div
        layout
        key={order.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        onClick={onToggleExpand}
        className={`border-b-2 px-0 py-3 transition-colors relative cursor-pointer ${
          isStockTab
            ? 'bg-white border-red-300 hover:border-red-500'
            : isExpanded
              ? 'bg-white border-emerald-500'
              : 'bg-white border-emerald-200 hover:border-emerald-500'
        }`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4 px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={getDisplayShipByDate(order) || ''}
              showPrefix={false}
              className="[&>span]:text-[14px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
            />
            <span className={`text-[14px] font-black ${getDaysLateTone(daysLate)}`}>
              {daysLate}
            </span>
            <AssignmentChip tester_id={order.tester_id} />
          </div>
          <div className="flex items-center gap-2">
            <PlatformExternalChip
              orderId={order.order_id}
              accountSource={order.account_source}
              canOpen={!!getExternalUrlByItemNumber(order.item_number)}
              onOpen={() => openExternalByItemNumber(order.item_number)}
            />
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500"
            >
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-black text-gray-900">{quantity}</span>
              <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">-</span>
              <span className="text-[13px] font-black uppercase truncate text-gray-900">
                {order.condition || 'No Condition'}
              </span>
            </div>
            <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
              #{getOrderIdLast4(order.order_id)}
            </span>
          </div>
          <h4 className="text-base font-black text-gray-900 leading-tight">{order.product_title}</h4>
        </div>

        {/* ── Action buttons — always visible ── */}
        {showActions && (
          <div className="px-3 mt-2.5 flex flex-col gap-2">
            {!hasOutOfStock ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onMissingPartsToggle(order.id); }}
                  className="flex-1 py-2 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Out of Stock
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onStart(order); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onStart(order); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </button>
            )}

            <AnimatePresence initial={false}>
              {showMissingPartsInput === order.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={missingPartsReason}
                      onChange={(e) => onMissingPartsReasonChange(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="What parts are missing?"
                      className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-gray-400"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); onMissingPartsCancel(); }}
                        className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onMissingPartsSubmit(order.id); }}
                        disabled={!missingPartsReason.trim()}
                        className="flex-1 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Expanded details ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-order"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-emerald-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">

                  {/* Row 1: Source | Item # */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Source</div>
                    <div className="break-words text-[11px] text-gray-900 normal-case tracking-normal">
                      {order.account_source || 'Unknown'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Item #</div>
                    <div className="break-words text-[11px] text-gray-900 normal-case tracking-normal">
                      {order.item_number || 'None'}
                    </div>
                  </div>

                  {/* Row 2: Tech (+ edit) | Tracking */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-gray-900 normal-case tracking-normal">
                        {order.tester_name || 'Unassigned'}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 text-gray-400 hover:text-emerald-600 transition-colors"
                        aria-label="Edit assignment"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="mb-1 text-gray-400">Tracking</div>
                    <div className="text-[11px] text-gray-900 normal-case tracking-normal font-mono">
                      {getOrderIdLast4(order.shipping_tracking_number || order.order_id)}
                    </div>
                  </div>

                </div>

                {hasOutOfStock && (
                  <OutOfStockField value={String(order.out_of_stock || '')} className="mt-3" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Assignment overlay — portal to escape framer-motion transform stacking context */}
      {mounted && createPortal(
        <AnimatePresence>
          {showAssignment && (
            <WorkOrderAssignmentCard
              rows={[buildWorkOrderRow(order)]}
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
