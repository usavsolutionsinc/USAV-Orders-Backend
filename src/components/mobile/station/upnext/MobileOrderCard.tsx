'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
} from '@/design-system';
import { Check, ChevronDown, Copy, ExternalLink, Play, Settings } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { getTrackingUrl } from '@/utils/order-links';
import { isEmptyDisplayValue, missingItemNumberLabel } from '@/utils/empty-display-value';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { Order } from '@/components/station/upnext/upnext-types';
import { UpNextActionButton } from '@/components/station/upnext/UpNextActionButton';
import { TECH_IDS } from '@/utils/staff';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';

/* ── Helpers (same logic as desktop OrderCard) ──────────────────────────────── */

interface StaffOption { id: number; name: string; }

function buildWorkOrderRow(order: Order): WorkOrderRow {
  return {
    id:          `order-${order.id}`,
    entityType:  'ORDER',
    entityId:    order.id,
    queueKey:    'orders',
    queueLabel:  'Orders',
    title:       order.product_title || 'Unknown Product',
    subtitle:    [order.order_id, order.shipping_tracking_number, order.sku].filter(Boolean).join(' \u2022 '),
    recordLabel: order.order_id || '',
    sourcePath:  '/work-orders',
    techId:      order.tester_id ?? null,
    techName:    order.tester_name ?? null,
    packerId:    order.packer_id ?? null,
    packerName:  order.packer_name ?? null,
    status:      'OPEN',
    priority:    0,
    deadlineAt:  order.ship_by_date ?? null,
    notes:       null,
    assignedAt:  null,
    updatedAt:   null,
    orderId:     order.order_id || null,
    trackingNumber: order.shipping_tracking_number || null,
  };
}

function getOrderIdLast4(orderId: string) {
  const digits = String(orderId || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(orderId || '').slice(-4);
}

function getLast4(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  const raw = String(value || '').trim();
  return raw.length > 4 ? raw.slice(-4) : raw || 'None';
}

function getTrackingLast4(tracking: string) {
  const digits = String(tracking || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(tracking || '').slice(-4);
}

function getDisplayShipByDate(order: Order) {
  const shipByRaw = String(order.ship_by_date || '').trim();
  const createdAtRaw = String(order.created_at || '').trim();
  const isInvalid = !shipByRaw || /^\d+$/.test(shipByRaw) || Number.isNaN(new Date(shipByRaw).getTime());
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

function getConditionColor(condition: string | null | undefined) {
  const c = (condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}

function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

/* ── Props (same as desktop) ────────────────────────────────────────────────── */

interface MobileOrderCardProps {
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

/* ── Component ──────────────────────────────────────────────────────────────── */

export function MobileOrderCard({
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
}: MobileOrderCardProps) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();

  // Assignment overlay
  const [showAssignment, setShowAssignment]       = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPackerOptions]         = useState<StaffOption[]>([]);
  const [mounted, setMounted]                     = useState(false);
  const [copiedTracking, setCopiedTracking]       = useState(false);
  const [copiedItemNumber, setCopiedItemNumber]   = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (showMissingPartsInput === order.id) {
      onMissingPartsReasonChange(String(order.out_of_stock || ''));
    }
  }, [showMissingPartsInput, order.id, order.out_of_stock, onMissingPartsReasonChange]);

  const showActions   = effectiveTab !== 'stock';
  const isStockTab    = effectiveTab === 'stock';
  const hasOutOfStock = String(order.out_of_stock || '').trim() !== '';
  const quantity      = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  const daysLate      = getDaysLateNumber(order.ship_by_date, order.created_at);
  const trackingNumber = String(order.shipping_tracking_number || '').trim();
  const itemNumberRaw = String(order.item_number || '').trim();
  const itemNumberValue = isEmptyDisplayValue(order.item_number) ? '' : itemNumberRaw;
  const trackingUrl = getTrackingUrl(trackingNumber);

  const handleCopyTracking = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackingNumber) return;
    try {
      await navigator.clipboard.writeText(trackingNumber);
      setCopiedTracking(true);
      window.setTimeout(() => setCopiedTracking(false), 1500);
    } catch {
      // noop
    }
  };

  const handleCopyItemNumber = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!itemNumberValue) return;
    try {
      await navigator.clipboard.writeText(itemNumberValue);
      setCopiedItemNumber(true);
      window.setTimeout(() => setCopiedItemNumber(false), 1500);
    } catch {
      // noop
    }
  };

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
        initial={framerPresenceMobile.mobileCard.initial}
        animate={framerPresenceMobile.mobileCard.animate}
        exit={framerPresenceMobile.mobileCard.exit}
        transition={framerTransitionMobile.mobileCardMount}
        onClick={onToggleExpand}
        className={`rounded-2xl border mb-2 px-0 py-3 transition-colors relative ${
          isStockTab
            ? 'bg-white border-red-300 active:border-red-500'
            : isExpanded
              ? 'bg-white border-emerald-500'
              : 'bg-white border-emerald-200 active:border-emerald-500'
        }`}
      >
        {/* -- Header -- */}
        <div className="flex items-center justify-between mb-4 px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={getDisplayShipByDate(order) || ''}
              showPrefix={false}
              showYear={false}
              className="[&>span]:text-[15px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
            />
            <span className={`text-[15px] font-black ${getDaysLateTone(daysLate)}`}>
              {daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[12px] font-extrabold font-mono text-gray-900 px-1.5 py-0.5 rounded border border-gray-300`}>
              #{getOrderIdLast4(order.order_id)}
            </span>
            <PlatformExternalChip
              orderId={order.order_id}
              accountSource={order.account_source}
              canOpen={!!getExternalUrlByItemNumber(order.item_number)}
              onOpen={() => openExternalByItemNumber(order.item_number)}
            />
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={framerTransition.upNextChevron}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 text-emerald-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(34,197,94,0.16)] active:scale-95 transition-transform"
            >
              <ChevronDown className="w-5 h-5" />
            </motion.span>
          </div>
        </div>

        {/* -- Body -- */}
        <div className="px-3">
          <h4 className="text-[17px] font-black text-gray-900 leading-tight">
            <InlineQtyPrefix quantity={quantity} />
            <span className={getConditionColor(order.condition)}>{order.condition || 'No Condition'}</span>
            {' '}{order.product_title}
          </h4>
        </div>

        {hasOutOfStock && (
          <div className="mt-2 border-t border-red-100 px-3 pt-2" onClick={(e) => e.stopPropagation()}>
            <OutOfStockField
              value={String(order.out_of_stock || '')}
              onEdit={() => onMissingPartsToggle(order.id)}
            />
          </div>
        )}

        {/* -- Action buttons / editors -- */}
        {(showActions || hasOutOfStock || showMissingPartsInput === order.id) && (
          <div className="px-3 mt-2.5 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {showMissingPartsInput === order.id && (
                <div onClick={(e) => e.stopPropagation()}>
                  <OutOfStockEditorBlock
                    value={missingPartsReason}
                    onChange={onMissingPartsReasonChange}
                    onCancel={onMissingPartsCancel}
                    onSubmit={() => onMissingPartsSubmit(order.id)}
                    autoFocus
                    className="pt-0.5"
                  />
                </div>
              )}
            </AnimatePresence>

            {!hasOutOfStock ? (
              showActions && (
                <div className="flex items-center gap-3">
                  <UpNextActionButton
                    onClick={(e) => { e.stopPropagation(); onMissingPartsToggle(order.id); }}
                    label="Out of Stock"
                    tone="red"
                    fullWidth
                    className="flex-1 min-h-[48px]"
                  />
                  <UpNextActionButton
                    onClick={(e) => { e.stopPropagation(); onStart(order); }}
                    label="Start"
                    icon={<Play className="w-4 h-4" />}
                    tone="emerald"
                    fullWidth
                    className="flex-1 min-h-[48px]"
                  />
                </div>
              )
            ) : (
              <UpNextActionButton
                onClick={(e) => { e.stopPropagation(); onStart(order); }}
                label="Start"
                icon={<Play className="w-4 h-4" />}
                tone="emerald"
                fullWidth
                className="min-h-[48px]"
              />
            )}
          </div>
        )}

        {/* -- Expanded details -- */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-order"
              initial={framerPresence.collapseHeight.initial}
              animate={framerPresence.collapseHeight.animate}
              exit={framerPresence.collapseHeight.exit}
              transition={framerTransition.upNextCollapse}
              style={{ willChange: 'height, opacity' }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-emerald-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-700`}>

                  {/* Source */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Source</div>
                    <div className="break-words text-[12px] font-bold text-gray-900 normal-case tracking-normal">
                      {order.account_source || 'Unknown'}
                    </div>
                  </div>

                  {/* Item # */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Item #</div>
                    <div className="flex items-center justify-between gap-1">
                      <div className="min-w-0 text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                        {itemNumberValue
                          ? getLast4(itemNumberValue)
                          : missingItemNumberLabel(order.order_id, order.account_source)}
                      </div>
                      <div className="flex items-center gap-1">
                        {itemNumberValue ? (
                          <button
                            type="button"
                            onClick={handleCopyItemNumber}
                            className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform"
                            aria-label={copiedItemNumber ? 'Item number copied' : 'Copy item number'}
                          >
                            {copiedItemNumber ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (itemNumberValue) openExternalByItemNumber(itemNumberValue);
                          }}
                          disabled={!itemNumberValue}
                          className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform disabled:opacity-50"
                          aria-label="Open item in external page"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Tech (+ edit) */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Tech</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-bold text-gray-900 normal-case tracking-normal">
                        {order.tester_name || 'Unassigned'}
                      </span>
                      <button
                        onClick={openAssignment}
                        className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform"
                        aria-label="Edit assignment"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Tracking */}
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <div className="mb-1 text-gray-500">Tracking</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[12px] font-bold text-gray-900 normal-case tracking-normal break-words">
                        {trackingNumber ? getTrackingLast4(trackingNumber) : 'N/A'}
                      </div>
                      <div className="flex items-center gap-1">
                        {trackingNumber ? (
                          <button
                            type="button"
                            onClick={handleCopyTracking}
                            className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform"
                            aria-label={copiedTracking ? 'Tracking copied' : 'Copy tracking number'}
                          >
                            {copiedTracking ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (trackingUrl) window.open(trackingUrl, '_blank', 'noopener,noreferrer');
                          }}
                          disabled={!trackingUrl}
                          className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform disabled:opacity-50"
                          aria-label="Open tracking in external tab"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Assignment overlay -- portal to escape framer-motion transform stacking context */}
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
