'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
} from '@/design-system';
import { ShipByDate } from '../ui/ShipByDate';
import { Check, ClipboardList, Copy, ExternalLink, ChevronDown, Loader2, X } from '@/components/Icons';
import type { ActiveStationOrder, ResolvedProductManual } from '@/hooks/useStationTestingController';
import { getOrderIdLast4 } from '@/hooks/useStationTestingController';
import { getTrackingUrl } from '@/utils/order-links';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';

function getTrackingLast4(tracking: string) {
  const digits = String(tracking || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(tracking || '').slice(-4);
}

function getDisplayShipByDate(order: ActiveStationOrder) {
  const shipByRaw = String(order.shipByDate || '').trim();
  const createdAtRaw = String(order.createdAt || '').trim();
  const isInvalid =
    !shipByRaw || /^\d+$/.test(shipByRaw) || Number.isNaN(new Date(shipByRaw).getTime());
  return isInvalid ? createdAtRaw || null : shipByRaw;
}

function getDaysLateNumber(shipByDate: string | null | undefined, fallbackDate?: string | null) {
  const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
  const todayKey = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;
  const [sy, sm, sd] = shipByKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - shipByIndex);
}

function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

interface ActiveStationOrderCardProps {
  activeOrder: ActiveStationOrder;
  activeColorTextClass: string;
  resolvedManuals: ResolvedProductManual[];
  isManualLoading: boolean;
  onViewManual?: () => void;
  onRemoveSerial?: (serial: string, index: number) => Promise<void> | void;
}

export default function ActiveStationOrderCard({
  activeOrder,
  activeColorTextClass,
  resolvedManuals,
  isManualLoading,
  onViewManual,
  onRemoveSerial,
}: ActiveStationOrderCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastAddedSerial, setLastAddedSerial] = useState<string | null>(null);
  const [copiedTracking, setCopiedTracking] = useState(false);
  const [removingSerialKey, setRemovingSerialKey] = useState<string | null>(null);
  const [serialRemoveError, setSerialRemoveError] = useState<string | null>(null);
  const prevTrackingRef = React.useRef(activeOrder.tracking);
  const prevSerialCountRef = React.useRef(activeOrder.serialNumbers.length);

  useEffect(() => {
    if (prevTrackingRef.current !== activeOrder.tracking) {
      prevTrackingRef.current = activeOrder.tracking;
      prevSerialCountRef.current = activeOrder.serialNumbers.length;
      setLastAddedSerial(null);
      return;
    }

    const prev = prevSerialCountRef.current;
    const current = activeOrder.serialNumbers.length;
    if (current > prev) {
      const newSerial = activeOrder.serialNumbers[current - 1];
      setLastAddedSerial(newSerial);
      const timer = setTimeout(() => setLastAddedSerial(null), 1800);
      prevSerialCountRef.current = current;
      return () => clearTimeout(timer);
    }
    prevSerialCountRef.current = current;
  }, [activeOrder.serialNumbers, activeOrder.tracking]);

  const primaryManual = resolvedManuals[0] ?? null;
  const quantity = Math.max(1, Number(activeOrder.quantity) || 1);
  const daysLate = getDaysLateNumber(activeOrder.shipByDate, activeOrder.createdAt);
  const trackingNumber = String(activeOrder.tracking || '').trim();
  const trackingUrl = getTrackingUrl(trackingNumber);

  const handleCopyTracking = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackingNumber) return;
    try {
      await navigator.clipboard.writeText(trackingNumber);
      setCopiedTracking(true);
      window.setTimeout(() => setCopiedTracking(false), 1500);
    } catch {
      /* noop */
    }
  };

  const handleRemoveSerial = async (e: React.MouseEvent, serial: string, index: number) => {
    e.stopPropagation();
    if (!onRemoveSerial || removingSerialKey) return;
    setSerialRemoveError(null);
    const rowKey = `${serial}-${index}`;
    setRemovingSerialKey(rowKey);
    try {
      await onRemoveSerial(serial, index);
    } catch (error) {
      setSerialRemoveError(error instanceof Error ? error.message : 'Failed to remove serial');
    } finally {
      setRemovingSerialKey(null);
    }
  };

  return (
    <motion.div
      key={activeOrder.tracking}
      initial={framerPresence.stationCard.initial}
      animate={framerPresence.stationCard.animate}
      exit={framerPresence.stationCard.exit}
      transition={framerTransition.stationCardMount}
      className="rounded-2xl border-2 border-emerald-200 bg-white shadow-sm overflow-hidden"
    >
      {/* ── Header + title (tap to expand details — matches Up Next OrderCard) ── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className="w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-inset"
      >
        <div className="flex items-center justify-between px-3 pt-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShipByDate
              date={getDisplayShipByDate(activeOrder) || ''}
              showPrefix={false}
              showYear={false}
              className="[&>span]:text-[14px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
            />
            <span className={`text-[14px] font-black tabular-nums ${getDaysLateTone(daysLate)}`}>
              {daysLate}
            </span>
            {activeOrder.orderFound === false && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-50 border border-amber-200 text-amber-700 leading-none shrink-0">
                <span className="w-1 h-1 rounded-full bg-amber-400 inline-block" />
                Logged
              </span>
            )}
          </div>
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={framerTransition.stationChevron}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500 shrink-0"
            aria-hidden
          >
            <ChevronDown className="w-4 h-4" />
          </motion.span>
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-[13px] font-black tabular-nums ${quantity > 1 ? 'text-amber-700' : 'text-gray-900'}`}
              >
                {quantity}
              </span>
              <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">-</span>
              <span className="text-[13px] font-black uppercase truncate text-gray-900">
                {activeOrder.condition || 'No Condition'}
              </span>
            </div>
            <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300 shrink-0">
              #{getOrderIdLast4(activeOrder.orderId)}
            </span>
          </div>
          <h3 className="text-base font-black text-gray-900 leading-tight">{activeOrder.productTitle}</h3>
        </div>
      </button>

      {activeOrder.notes && (
        <div className="px-3 mt-2 border-t border-gray-100 pt-2">
          <div className="flex items-center gap-2">
            <ClipboardList className={`w-4 h-4 shrink-0 ${activeColorTextClass}`} />
            <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Testing Notes</p>
          </div>
          <p className="mt-1.5 text-xs font-medium text-gray-700 bg-gray-50/80 p-3 rounded-xl border border-gray-100 leading-relaxed">
            {activeOrder.notes}
          </p>
        </div>
      )}

      {/* ── Expanded detail grid (OrderCard-style) ── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="expanded-active-order"
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.stationCollapse}
            className="overflow-hidden"
          >
            <div
              className="mt-2 border-t border-emerald-100 px-3 pt-3 pb-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                <div className="min-w-0 rounded-xl bg-gray-50 px-2 py-2">
                  <div className="mb-1 text-gray-400">SKU</div>
                  <div className="truncate text-[11px] text-gray-900 normal-case tracking-normal font-mono font-bold" title={activeOrder.sku || undefined}>
                    {activeOrder.sku || '—'}
                  </div>
                </div>
                <div className="min-w-0 w-fit max-w-full rounded-xl bg-gray-50 px-2 py-2">
                  <div className="mb-1 whitespace-nowrap text-gray-400">Item #</div>
                  <div
                    className="block max-w-full truncate text-[11px] text-gray-900 normal-case tracking-normal"
                    title={activeOrder.itemNumber || undefined}
                  >
                    {activeOrder.itemNumber || 'None'}
                  </div>
                </div>
                <div className="min-w-0 rounded-xl bg-gray-50 px-2 py-2">
                  <div className="mb-1 text-gray-400">Tracking</div>
                  <div className="flex items-center justify-between gap-1">
                    <div
                      className="min-w-0 truncate text-[11px] text-gray-900 normal-case tracking-normal font-mono font-bold"
                      title={trackingNumber || undefined}
                    >
                      {trackingNumber ? getTrackingLast4(trackingNumber) : '—'}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleCopyTracking}
                        disabled={!trackingNumber}
                        className="flex-shrink-0 text-gray-400 hover:text-emerald-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={copiedTracking ? 'Tracking copied' : 'Copy tracking number'}
                      >
                        {copiedTracking ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (trackingUrl) window.open(trackingUrl, '_blank', 'noopener,noreferrer');
                        }}
                        disabled={!trackingUrl}
                        className="flex-shrink-0 text-gray-400 hover:text-emerald-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Open tracking in external tab"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual directly above serials — single column stack */}
      <div className="flex flex-col">
        {activeOrder.orderFound !== false && !isManualLoading && primaryManual && (
          <div className="border-t border-blue-100 bg-blue-50/40 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] font-black text-blue-700 uppercase tracking-wider">Product Manual</p>
                <p className="text-[10px] font-bold text-blue-900 truncate">
                  {resolvedManuals.length > 1
                    ? `${resolvedManuals.length} manuals linked`
                    : primaryManual.type || 'Manual linked'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <a
                  href={primaryManual.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-200 bg-white hover:bg-blue-50 text-[10px] font-black uppercase tracking-wider text-blue-700 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </a>
                <button
                  type="button"
                  onClick={onViewManual}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider transition-colors"
                >
                  View Manual
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Serial numbers ── */}
        <AnimatePresence initial={false}>
        {activeOrder.serialNumbers.length > 0 && (
          <motion.div
            key="serials-section"
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.stationCollapse}
            className="overflow-hidden border-t border-emerald-100"
          >
            <div className="p-4 bg-emerald-50/60 space-y-2">
              <p className="text-[9px] font-black text-emerald-700 uppercase tracking-wider">
                Scanned Serials ({activeOrder.serialNumbers.length}
                {quantity > 1 ? ` / ${quantity}` : ''})
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {activeOrder.serialNumbers.map((sn, index) => {
                    const isNew = sn === lastAddedSerial;
                    const isRemoving = removingSerialKey === `${sn}-${index}`;
                    return (
                      <motion.div
                        key={`${sn}-${index}`}
                        initial={framerPresence.stationSerialRow.initial}
                        animate={framerPresence.stationSerialRow.animate}
                        exit={framerPresence.stationSerialRow.exit}
                        transition={framerTransition.stationSerialRow}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors duration-500 ${
                          isNew
                            ? 'bg-emerald-200 border-emerald-400 shadow-sm'
                            : 'bg-white border-emerald-100'
                        }`}
                      >
                        <Check className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                        <span className="text-xs font-mono font-bold text-emerald-700 flex-1">{sn}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <AnimatePresence>
                            {isNew && (
                              <motion.span
                                initial={framerPresence.stationAddedBadge.initial}
                                animate={framerPresence.stationAddedBadge.animate}
                                exit={framerPresence.stationAddedBadge.exit}
                                transition={framerTransition.stationAddedBadge}
                                className="text-[9px] font-black text-emerald-600 uppercase tracking-wider"
                              >
                                ✓ Added
                              </motion.span>
                            )}
                          </AnimatePresence>
                          {onRemoveSerial && (
                            <button
                              type="button"
                              onClick={(e) => void handleRemoveSerial(e, sn, index)}
                              disabled={Boolean(removingSerialKey)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              aria-label={`Remove serial ${sn}`}
                              title={`Remove serial ${sn}`}
                            >
                              {isRemoving ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
              {serialRemoveError && (
                <p className="text-[10px] font-bold text-red-600">{serialRemoveError}</p>
              )}
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
