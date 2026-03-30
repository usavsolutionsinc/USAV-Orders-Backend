'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
} from '@/design-system';
import { ShipByDate } from '../ui/ShipByDate';
import { cardTitle, chipText } from '@/design-system/tokens/typography/presets';
import { Check, ClipboardList, Copy, ExternalLink, ChevronDown, Loader2, Package, X } from '@/components/Icons';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import type { ActiveStationOrder, ResolvedProductManual } from '@/hooks/useStationTestingController';
import { getOrderIdLast4 } from '@/hooks/useStationTestingController';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { getTrackingUrl } from '@/utils/order-links';
import { isEmptyDisplayValue, missingItemNumberLabelForStation } from '@/utils/empty-display-value';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';

type OrderVariant = 'order' | 'fba' | 'repair';

type CopyFieldKey = 'sku' | 'itemNumber' | 'tracking';

function getLast4(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return raw.slice(-4);
}

function inferOrderVariant(order: ActiveStationOrder): OrderVariant {
  const sourceType = order.sourceType;
  if (
    sourceType === 'fba' ||
    String(order.orderId || '').toUpperCase() === 'FNSKU' ||
    looksLikeFnsku(String(order.fnsku || ''))
  ) {
    return 'fba';
  }

  if (sourceType === 'repair' || /^RS-/i.test(String(order.orderId || '')) || /^RS-/i.test(String(order.tracking || ''))) {
    return 'repair';
  }

  return 'order';
}

const chevronPinkFba =
  'border-pink-200 text-pink-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(236,72,153,0.16)]';

function getVariantStyles(variant: OrderVariant) {
  const chevronEmerald =
    'border-emerald-200 text-emerald-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(34,197,94,0.16)]';
  switch (variant) {
    case 'fba':
      return {
        card: 'border-purple-300 hover:border-purple-500',
        focus: 'focus-visible:ring-purple-400/50',
        section: 'border-pink-200',
        accent: 'text-emerald-600',
        chevron: chevronPinkFba,
      };
    case 'repair':
      return {
        card: 'border-orange-300 hover:border-orange-500',
        focus: 'focus-visible:ring-orange-400/50',
        section: 'border-orange-100',
        accent: 'text-orange-600',
        chevron:
          'border-orange-200 text-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(234,88,12,0.14)]',
      };
    case 'order':
    default:
      return {
        card: 'border-emerald-200 hover:border-emerald-500',
        focus: 'focus-visible:ring-emerald-400/50',
        section: 'border-emerald-100',
        accent: 'text-emerald-600',
        chevron: chevronEmerald,
      };
  }
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

function getConditionColor(condition: string | null | undefined) {
  const c = (condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}

function stripConditionPrefix(title: string | null | undefined, condition: string | null | undefined) {
  const t = (title || '').trimStart();
  const c = (condition || '').trim();
  if (!t || !c) return t;
  if (t.toLowerCase().startsWith(c.toLowerCase())) return t.slice(c.length).trimStart();
  return t;
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
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastAddedSerial, setLastAddedSerial] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<CopyFieldKey | null>(null);
  const [removingSerialKey, setRemovingSerialKey] = useState<string | null>(null);
  const [serialRemoveError, setSerialRemoveError] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const prevTrackingRef = React.useRef(activeOrder.tracking);
  const prevSerialCountRef = React.useRef(activeOrder.serialNumbers.length);
  const orderVariant = inferOrderVariant(activeOrder);
  const variantStyles = getVariantStyles(orderVariant);

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

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const primaryManual = resolvedManuals[0] ?? null;
  const quantity = Math.max(1, Number(activeOrder.quantity) || 1);
  const daysLate = getDaysLateNumber(activeOrder.shipByDate, activeOrder.createdAt);
  const trackingNumber = String(activeOrder.tracking || '').trim();
  const skuValue = isEmptyDisplayValue(activeOrder.sku) ? '' : String(activeOrder.sku || '').trim();
  const itemNumberValue = isEmptyDisplayValue(activeOrder.itemNumber)
    ? ''
    : String(activeOrder.itemNumber || '').trim();
  const displayIdentifier = orderVariant === 'fba'
    ? getLast4(activeOrder.fnsku || activeOrder.tracking)
    : getOrderIdLast4(activeOrder.orderId);
  const trackingUrl = getTrackingUrl(trackingNumber);

  const handleCopyValue = async (e: React.MouseEvent, key: CopyFieldKey, value: string) => {
    e.stopPropagation();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopiedField(null), 1500);
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
      className={`rounded-2xl border-2 bg-white shadow-sm overflow-hidden transition-colors ${variantStyles.card}`}
    >
      {/* ── Header + title (tap to expand details — matches Up Next OrderCard) ── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className={`w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${variantStyles.focus}`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-3 pt-3 mb-4">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={getDisplayShipByDate(activeOrder) || ''}
              showPrefix={false}
              showYear={false}
              {...(orderVariant === 'fba'
                ? {
                    icon: Package,
                    iconClassName: 'w-4 h-4 text-purple-600',
                    textClassName: 'text-[14px] font-black text-blue-700',
                    className: '',
                  }
                : {
                    className: '[&>span]:text-[14px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4',
                  })}
            />
            <span className={`text-[14px] font-black tabular-nums ${getDaysLateTone(daysLate)}`}>
              {daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openExternalByItemNumber(activeOrder.itemNumber);
              }}
              disabled={orderVariant !== 'order' || !getExternalUrlByItemNumber(activeOrder.itemNumber)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-2 text-gray-900 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 disabled:hover:bg-white disabled:hover:border-gray-300 disabled:hover:text-gray-900 transition-colors"
            >
              <span className={`${chipText} leading-none translate-y-px`}>#{displayIdentifier}</span>
              <ExternalLink className="w-3.5 h-3.5 text-blue-300" />
            </button>
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={framerTransition.stationChevron}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border shrink-0 ${variantStyles.chevron}`}
              aria-hidden
            >
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3 pb-4">
          <h3 className={cardTitle}>
            <InlineQtyPrefix quantity={quantity} />
            <span className={getConditionColor(activeOrder.condition)}>{activeOrder.condition || 'No Condition'}</span>
            {' '}{stripConditionPrefix(activeOrder.productTitle, activeOrder.condition)}
          </h3>
          {activeOrder.inlineMicrocopy ? (
            <p className="mt-2 text-[11px] font-semibold leading-snug text-emerald-700">
              {activeOrder.inlineMicrocopy}
            </p>
          ) : null}
        </div>
      </button>

      {activeOrder.notes && (
        <div className={`px-3 mt-2 border-t pt-2 ${variantStyles.section}`}>
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
                className={`mt-2 border-t px-3 pt-3 pb-1 ${variantStyles.section}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  <div className="min-w-0 rounded-xl bg-gray-50 px-2 py-2">
                    <div className="mb-1 text-gray-400">SKU</div>
                    <div className="flex items-center justify-between gap-1">
                      <div
                        className="min-w-0 truncate text-[11px] text-gray-900 normal-case tracking-normal font-mono font-bold"
                        title={skuValue || undefined}
                      >
                        {skuValue ? getLast4(skuValue) : 'N/A'}
                      </div>
                      {skuValue ? (
                        <button
                          type="button"
                          onClick={(e) => void handleCopyValue(e, 'sku', skuValue)}
                          className="flex-shrink-0 text-gray-400 hover:text-emerald-600 transition-colors"
                          aria-label={copiedField === 'sku' ? 'SKU copied' : 'Copy SKU'}
                        >
                          {copiedField === 'sku' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0 w-fit max-w-full rounded-xl bg-gray-50 px-2 py-2">
                    <div className="mb-1 whitespace-nowrap text-gray-400">Item #</div>
                    <div className="flex items-center justify-between gap-1">
                      <div
                        className="block min-w-0 max-w-full truncate text-[11px] text-gray-900 normal-case tracking-normal"
                        title={itemNumberValue || undefined}
                      >
                        {itemNumberValue
                          ? getLast4(itemNumberValue)
                          : missingItemNumberLabelForStation(activeOrder.orderId, orderVariant)}
                      </div>
                      {itemNumberValue ? (
                        <button
                          type="button"
                          onClick={(e) => void handleCopyValue(e, 'itemNumber', itemNumberValue)}
                          className="flex-shrink-0 text-gray-400 hover:text-emerald-600 transition-colors"
                          aria-label={copiedField === 'itemNumber' ? 'Item number copied' : 'Copy item number'}
                        >
                          {copiedField === 'itemNumber' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-xl bg-gray-50 px-2 py-2">
                    <div className="mb-1 text-gray-400">Tracking</div>
                    <div className="flex items-center justify-between gap-1">
                      <div
                        className="min-w-0 truncate text-[11px] text-gray-900 normal-case tracking-normal font-mono font-bold"
                        title={trackingNumber || undefined}
                      >
                        {trackingNumber ? getLast4(trackingNumber) : 'N/A'}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {trackingNumber ? (
                          <button
                            type="button"
                            onClick={(e) => void handleCopyValue(e, 'tracking', trackingNumber)}
                            className="flex-shrink-0 text-gray-400 hover:text-emerald-600 transition-colors"
                            aria-label={copiedField === 'tracking' ? 'Tracking copied' : 'Copy tracking number'}
                          >
                            {copiedField === 'tracking' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        ) : null}
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
          <div className={`border-t bg-blue-50/40 px-4 py-3 ${variantStyles.section}`}>
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
            className={`overflow-hidden border-t ${variantStyles.section}`}
          >
            <div className="p-4 bg-emerald-50/60 space-y-2">
              <p className={`text-[9px] font-black uppercase tracking-wider ${variantStyles.accent}`}>
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
