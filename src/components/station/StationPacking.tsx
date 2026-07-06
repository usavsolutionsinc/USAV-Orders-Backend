'use client';

import React, { useEffect, useRef, useState } from 'react';
import { LinkedTicketsPanel } from '@/components/linkage/LinkedTicketsPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, AlertCircle, Loader2, Package } from '../Icons';
import { getLast4 } from '../ui/CopyChip';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { formatPSTTimestamp } from '@/utils/date';
import StationGoalBar from './StationGoalBar';
import { StationScanBar } from './StationScanBar';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { OrderPackChecklist } from '@/components/packing/OrderPackChecklist';
import { usePackingPolicy } from '@/hooks/usePackingPolicy';
import { useOrderPackChecklist } from '@/hooks/useOrderPackChecklist';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useAssistantContext } from '@/hooks/useAssistantContext';
import { STATION_SKILL } from '@/lib/assistant/page-skills';
import { dispatchPackActiveOrder } from '@/components/packer/usePackerOrderPane';

interface ActivePackingOrder {
  orderRowId: number | null;
  orderId: string;
  productTitle: string;
  qty: number;
  condition: string;
  tracking: string;
  scanType?: 'ORDERS' | 'SKU' | 'REPAIR';
  sku?: string;
}

interface ActiveFbaScan {
  fnsku: string;
  productTitle: string;
  shipmentRef: string | null;
  plannedQty: number;
  combinedPackScannedQty: number;
  isNew: boolean; // true if no existing fba_shipment_items row was found (added on-the-fly)
}

type PackMode = 'standard' | 'fragile' | 'multi';

const PACK_MODE_LABELS: Record<PackMode, string> = {
  standard: 'Standard',
  fragile: 'Fragile — extra bubble wrap, double-box if needed',
  multi: 'Multi-Item — verify ALL items before sealing',
};

interface StationPackingProps {
  userId: string;
  userName: string;
  staffId: number | string;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
  embedded?: boolean;
  /** Current pack mode selected in the sidebar mode rail. */
  packMode?: PackMode;
}

export default function StationPacking({
  userId,
  userName,
  staffId,
  todayCount = 0,
  goal = 50,
  onComplete,
  embedded = false,
  packMode = 'standard',
}: StationPackingProps) {
  // Global-assistant context: station Q&A skill fragment (plan §-2.2).
  useAssistantContext({ page: 'packing-station', station: 'PACKING', skill: STATION_SKILL });
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<ActivePackingOrder | null>(null);
  const [activeFba, setActiveFba] = useState<ActiveFbaScan | null>(null);
  const { data: packingPolicy } = usePackingPolicy();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: packChecklist, isLoading: checklistLoading } = useOrderPackChecklist({
    orderRowId: activeOrder?.orderRowId ?? null,
    sku: activeOrder?.sku,
    condition: activeOrder?.condition,
    productTitle: activeOrder?.productTitle,
    enabled: Boolean(activeOrder),
  });

  useEffect(() => {
    if (!activeOrder || activeFba) {
      dispatchPackActiveOrder(null);
      return;
    }
    dispatchPackActiveOrder({
      orderRowId: activeOrder.orderRowId,
      orderId: activeOrder.orderId,
      productTitle: activeOrder.productTitle,
      qty: activeOrder.qty,
      condition: activeOrder.condition,
      tracking: activeOrder.tracking,
      sku: activeOrder.sku,
      scanType: activeOrder.scanType,
    });
  }, [activeOrder, activeFba]);

  const { theme: themeColor, colors: themeColors, inputBorder, inputTheme: activeColor } = useStationTheme({ staffId });
  const { normalizeTrackingQuery, normalizeTracking } = useLast8TrackingSearch();

  const handleSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const scan = inputValue.trim();
    if (!scan || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);
    setActiveOrder(null);
    setActiveFba(null);

    try {
      // ── FBA path: FNSKU detected ───────────────────────────────────────────
      if (looksLikeFnsku(scan)) {
        const res = await fetch('/api/fba/items/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // staff_id is server-derived from the session cookie now.
          body: JSON.stringify({ fnsku: scan, station: 'PACK_STATION' }),
        });
        const data = await res.json();

        if (!res.ok) {
          setErrorMessage(data?.error || 'FBA scan failed');
        } else {
          setActiveFba({
            fnsku: data.fnsku,
            productTitle: data.product_title || scan,
            shipmentRef: data.shipment_ref || null,
            plannedQty: Number(data.planned_qty ?? data.expected_qty ?? 0),
            combinedPackScannedQty: Number(
              data.combined_pack_scanned_qty ?? data.actual_qty ?? 0
            ),
            isNew: !!data.is_new || !!data.auto_added_to_plan,
          });
          onComplete?.();
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }
      } else {
        // ── Regular packing path ───────────────────────────────────────────
        // Pre-normalize: strip USPS IMpb routing prefix (420+ZIP) for tracking inputs.
        // SKU (has `:`) and special commands (clean/FBA-) pass through raw.
        const isTrackingInput = !scan.includes(':') && !/^(clean|fba-)/i.test(scan);

        // FBA combined-shipment ship-on-scan: a UPS tracking number OR an FBA
        // shipment ID resolves to the same combined (LABEL_ASSIGNED) shipment
        // and marks the whole package SHIPPED. A 404 means it isn't an FBA
        // shipment, so fall through to the regular orders packing flow.
        if (isTrackingInput) {
          const shipRes = await fetch('/api/fba/shipments/mark-shipped', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scan }),
          });
          if (shipRes.status !== 404) {
            const shipData = await shipRes.json().catch(() => ({} as any));
            if (!shipRes.ok || !shipData?.success) {
              throw new Error(shipData?.error || 'FBA ship-on-scan failed');
            }
            const shippedRef =
              shipData.affected_shipments?.[0] != null
                ? `#${shipData.affected_shipments[0]}`
                : String(shipData.tracking_number || scan);
            setActiveFba({
              fnsku: '',
              productTitle: 'FBA Shipment — Shipped',
              shipmentRef: shippedRef,
              plannedQty: Number(shipData.marked_shipped ?? 0),
              combinedPackScannedQty: Number(shipData.marked_shipped ?? 0),
              isNew: false,
            });
            onComplete?.();
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
            return;
          }
        }

        const normalizedScan = isTrackingInput ? normalizeTracking(scan) : scan;
        const res = await fetch('/api/packing-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber: normalizedScan,
            photos: [],
            packerId: String(userId),
            packerName: userName,
            createdAt: formatPSTTimestamp(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to save packing scan');

        const resolvedScanType = String(data?.trackingType || '').trim() || 'ORDERS';
        if (resolvedScanType === 'FBA' && data?.fba) {
          // UPS tracking matched an FBA shipment — show as FBA card.
          setActiveFba({
            fnsku: String(data.fba.fnskus || '').split(',')[0]?.trim() || '',
            productTitle: String(data?.productTitle || '').trim() || 'FBA Shipment',
            shipmentRef: data.fba.shipment_ref || null,
            plannedQty: Number(data.fba.total_qty ?? 0),
            combinedPackScannedQty: Number(data.fba.total_qty ?? 0),
            isNew: false,
          });
        } else if (resolvedScanType === 'ORDERS' || resolvedScanType === 'SKU') {
          // SKU scans (e.g. '1071-B:A12') resolve productTitle via the Ecwid
          // platform mapping in /api/packing-logs, so render the same active
          // card the order path uses — but show the SKU in place of TRK#.
          const isSku = resolvedScanType === 'SKU';
          const skuValue = String(data?.sku || '').trim();
          const orderRowIdRaw = Number(data?.orderRowId);
          setActiveOrder({
            orderRowId: Number.isFinite(orderRowIdRaw) && orderRowIdRaw > 0 ? orderRowIdRaw : null,
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown product',
            qty: Math.max(1, Number(data?.qty ?? data?.quantity ?? data?.orderQty ?? 1) || 1),
            condition: String(data?.condition || '').trim() || 'N/A',
            tracking: String(data?.shippingTrackingNumber || scan).trim(),
            scanType: isSku ? 'SKU' : 'ORDERS',
            sku: skuValue || undefined,
          });
        }

        onComplete?.();
        if (data.packerRecord?.id) {
          window.dispatchEvent(new CustomEvent('packer-log-added', { detail: data.packerRecord }));
        }
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Scan failed');
    } finally {
      setInputValue('');
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-surface-card overflow-hidden ${embedded ? '' : 'border-r border-border-hairline'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`${SIDEBAR_GUTTER} ${embedded ? 'pt-2 pb-1' : 'pt-4 pb-2'} space-y-4`}>
          {/* Welcome header + goal bar — chrome for the standalone station page only.
              In the embedded sidebar we keep it minimal (scan bar only), matching the
              other dashboard sidebars. */}
          {!embedded && (
            <>
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl font-black text-text-default tracking-tighter">Welcome, {userName}</h2>
                  <div className={`p-3 ${themeColors.bg} text-white rounded-2xl shadow-lg ${themeColors.shadow}`}>
                    <Package className="w-4 h-4" />
                  </div>
                </div>
              </div>

              <StationGoalBar
                count={todayCount}
                goal={goal}
                label="PACKED"
                theme={themeColor}
              />
            </>
          )}

          {/* Mode reminder banner (Fragile / Multi-Item) — standalone station page
              only. The embedded sidebar stays minimal: the active mode already shows
              in the master-nav mode rail, so we don't repeat it here. */}
          {!embedded && packMode !== 'standard' ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-caption font-semibold text-amber-800">
              {PACK_MODE_LABELS[packMode]}
            </div>
          ) : null}

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 120 }}
          >
            <StationScanBar
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              inputRef={inputRef}
              placeholder="Tracking, FNSKU, FBA, SKU"
              icon={<Barcode className="h-[17px] w-[17px]" />}
              iconClassName={activeColor.text}
              inputBorderClassName={inputBorder}
              inputClassName={activeColor.ring}
              autoFocus
              rightContent={isLoading ? (
                <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
              ) : null}
            />
          </motion.div>

          {!embedded && (
            <p className="text-micro font-bold text-text-faint px-1">
              Supports tracking, FNSKU/ASIN (10 chars: <code className="font-mono">X00</code> or <code className="font-mono">B0</code> prefix), FBA, and{' '}
              <code className="font-mono">SKU:VALUE</code> scans.
            </p>
          )}
        </div>

        <div className={`flex-1 overflow-y-auto no-scrollbar ${SIDEBAR_GUTTER} pb-6 space-y-3`}>
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">{errorMessage}</p>
              </motion.div>
            )}

          </AnimatePresence>

          {/* FBA scan result card */}
          <AnimatePresence mode="wait">
            {activeFba && (
              <motion.div
                key={activeFba.fnsku}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="p-4 bg-surface-card rounded-2xl border border-purple-200 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-micro font-black text-purple-500 uppercase tracking-widest">FBA Scan</p>
                    {activeFba.isNew && (
                      <span className="text-eyebrow font-black bg-blue-100 text-blue-700 border border-blue-200 rounded-lg px-1.5 py-0.5 uppercase tracking-wider">
                        Added to Today
                      </span>
                    )}
                  </div>
                  {activeFba.shipmentRef && (
                    <span className="text-micro font-mono font-black text-purple-700">{activeFba.shipmentRef}</span>
                  )}
                </div>
                <h3 className="text-base font-black text-text-default leading-tight">{activeFba.productTitle}</h3>
                <div className="mt-3 flex items-stretch justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50/40 px-3 py-2.5">
                  <HoverTooltip label={activeFba.fnsku} asChild>
                    <div className="min-w-0 flex-1">
                      <p className="text-mini font-black text-purple-400 uppercase tracking-wider">FNSKU</p>
                      <p className="text-sm font-mono font-black text-text-default tabular-nums">{getLast4(activeFba.fnsku)}</p>
                    </div>
                  </HoverTooltip>
                  <div className="flex-1 text-center border-x border-purple-100/80 px-2">
                    <p className="text-mini font-black text-text-faint uppercase tracking-wider">Planned</p>
                    <p className="text-sm font-black text-text-default tabular-nums">
                      {activeFba.plannedQty > 0 ? activeFba.plannedQty : '—'}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    <p className="text-mini font-black text-text-faint uppercase tracking-wider">Scanned</p>
                    <p className="text-sm font-black text-text-default tabular-nums">
                      {activeFba.combinedPackScannedQty}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Regular order scan result — embedded sidebar stays compact; full
              checklist crossfades in the right pane (see ActivePackerWorkspace). */}
          <AnimatePresence mode="wait">
            {activeOrder && !activeFba && (
              <motion.div
                key={activeOrder.tracking}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="p-4 bg-surface-card rounded-2xl border border-border-soft shadow-sm"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-micro font-black text-text-soft uppercase tracking-widest">
                    {activeOrder.scanType === 'SKU' ? 'Active SKU' : 'Active Order'}
                  </p>
                  <span className="text-micro font-mono font-black text-text-muted">
                    {activeOrder.scanType === 'SKU'
                      ? (activeOrder.sku || activeOrder.tracking || 'N/A')
                      : (activeOrder.orderId || 'N/A')}
                  </span>
                </div>
                <h3 className="text-base font-black text-text-default leading-tight">{activeOrder.productTitle}</h3>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="bg-surface-canvas rounded-xl px-3 py-2 border border-border-hairline">
                    <p className="text-eyebrow font-black text-text-faint uppercase tracking-wider mb-1">Qty</p>
                    <p className="text-xs font-bold text-text-default">{activeOrder.qty}</p>
                  </div>
                  <div className="bg-surface-canvas rounded-xl px-3 py-2 border border-border-hairline">
                    <p className="text-eyebrow font-black text-text-faint uppercase tracking-wider mb-1">Condition</p>
                    <p className="text-xs font-bold text-text-default">{activeOrder.condition}</p>
                  </div>
                  <div className="bg-surface-canvas rounded-xl px-3 py-2 border border-border-hairline">
                    <p className="text-eyebrow font-black text-text-faint uppercase tracking-wider mb-1">
                      {activeOrder.scanType === 'SKU' ? 'SKU' : 'TRK #'}
                    </p>
                    <p className="text-xs font-mono font-bold text-text-default">
                      {activeOrder.scanType === 'SKU'
                        ? (activeOrder.sku || activeOrder.tracking || '—')
                        : (normalizeTrackingQuery(activeOrder.tracking) || '—')}
                    </p>
                  </div>
                </div>

                {embedded ? (
                  <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-caption font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Checklist open in the history pane — verify each line item before sealing.
                  </p>
                ) : (
                  <>
                    <OrderPackChecklist
                      lines={packChecklist?.lines ?? []}
                      enforcement={packingPolicy?.enforcement ?? packChecklist?.enforcement ?? 'advisory'}
                      resetKey={
                        activeOrder.orderRowId
                          ? `row-${activeOrder.orderRowId}`
                          : activeOrder.sku || activeOrder.tracking
                      }
                      isLoading={checklistLoading}
                      variant="station"
                      className="mt-3"
                    />
                    <div className="mt-3 border-t border-border-hairline pt-3">
                      <LinkedTicketsPanel
                        order={activeOrder.orderId || undefined}
                        tracking={activeOrder.tracking || undefined}
                        dense
                      />
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
