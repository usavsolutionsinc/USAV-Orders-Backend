'use client';

import React, { useState } from 'react';
import { Package, AlertTriangle, Settings, ExternalLink } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { getDaysLateNumber, getDaysLateTone } from '@/utils/date';
import { getLast4 } from '@/components/ui/CopyChip';
import { ShortPickSheet, type ShortPickResult } from '@/components/mobile/picker/ShortPickSheet';
import type { ActivePackingOrder, ActiveFbaScan } from './MobileStationPacking';

// ─── Types ──────────────────────────────────────────────────────────────────

type OrderVariant = 'order' | 'fba' | 'repair' | 'exception';

interface MobilePackingConfirmCardProps {
  order: ActivePackingOrder | null;
  fba: ActiveFbaScan | null;
  variant: OrderVariant;
  scannedValue: string;
  onConfirm: () => void;
  onReject: () => void;
  /**
   * Optional handler for short-pack confirmations (FBA variant only, when
   * `combinedPackScannedQty < plannedQty`). If omitted, the sheet still
   * collects a reason then falls through to `onConfirm()` so the existing
   * parent contract stays intact.
   */
  onShortPick?: (result: ShortPickResult) => void;
  /** Compact read-only mode for the review step (hides buttons) */
  compact?: boolean;
}

// ─── Helpers (adapted from ActiveStationOrderCard) ──────────────────────────

function getVariantConfig(variant: OrderVariant) {
  switch (variant) {
    case 'fba':
      return {
        border: 'border-purple-300',
        headerBg: 'bg-purple-50',
        headerText: 'text-purple-700',
        badge: 'bg-purple-100 text-purple-700 border-purple-200',
        label: 'FBA Shipment',
        confirmBtn: 'bg-purple-600 active:bg-purple-700',
      };
    case 'repair':
      return {
        border: 'border-orange-300',
        headerBg: 'bg-orange-50',
        headerText: 'text-orange-700',
        badge: 'bg-orange-100 text-orange-700 border-orange-200',
        label: 'Repair Service',
        confirmBtn: 'bg-orange-600 active:bg-orange-700',
      };
    case 'exception':
      return {
        border: 'border-amber-300',
        headerBg: 'bg-amber-50',
        headerText: 'text-amber-700',
        badge: 'bg-amber-100 text-amber-700 border-amber-200',
        label: 'Exception — No Match',
        confirmBtn: 'bg-amber-600 active:bg-amber-700',
      };
    case 'order':
    default:
      return {
        border: 'border-emerald-300',
        headerBg: 'bg-emerald-50',
        headerText: 'text-emerald-700',
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        label: 'Order Found',
        confirmBtn: 'bg-emerald-600 active:bg-emerald-700',
      };
  }
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


// ─── Component ──────────────────────────────────────────────────────────────

export function MobilePackingConfirmCard({
  order,
  fba,
  variant,
  scannedValue,
  onConfirm,
  onReject,
  onShortPick,
  compact = false,
}: MobilePackingConfirmCardProps) {
  const config = getVariantConfig(variant);
  const [shortSheetOpen, setShortSheetOpen] = useState(false);

  const fbaIsShort = !!fba && fba.plannedQty > 0 && fba.combinedPackScannedQty < fba.plannedQty;
  const handleFbaConfirmPress = () => {
    if (fbaIsShort) {
      setShortSheetOpen(true);
      return;
    }
    onConfirm();
  };
  const handleShortPickConfirm = (result: ShortPickResult) => {
    if (onShortPick) {
      onShortPick(result);
    } else {
      // Parent has not opted into short-pick capture yet — preserve existing
      // confirm-and-move-on behavior so we don't strand the worker on the sheet.
      onConfirm();
    }
  };

  // ── FBA variant ──
  if (fba && (variant === 'fba')) {
    return (
      <div className={`rounded-2xl border-2 bg-white overflow-hidden ${config.border}`}>
        {/* Header */}
        <div className={`px-4 py-3 ${config.headerBg} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-600" />
            <span className={`text-xs font-black uppercase tracking-wider ${config.headerText}`}>
              {config.label}
            </span>
            {fba.isNew && (
              <span className="text-xs font-black bg-blue-100 text-blue-700 border border-blue-200 rounded-lg px-1.5 py-0.5 uppercase tracking-wider">
                Added to Today
              </span>
            )}
          </div>
          {fba.shipmentRef && (
            <span className="text-xs font-mono font-black text-purple-700">{fba.shipmentRef}</span>
          )}
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          {!compact && (
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider">Ready to pack?</p>
          )}
          <h3 className="text-base font-black text-gray-900 leading-tight">{fba.productTitle}</h3>

          {/* Stats row */}
          <div className="flex items-stretch justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50/40 px-3 py-3">
            <div className="min-w-0 flex-1" title={fba.fnsku}>
              <p className="text-xs font-black text-purple-400 uppercase tracking-wider">FNSKU</p>
              <p className="text-sm font-mono font-black text-gray-900 tabular-nums">{getLast4(fba.fnsku)}</p>
            </div>
            <div className="flex-1 text-center border-x border-purple-100/80 px-2">
              <p className="text-xs font-black text-gray-400 uppercase tracking-wider">Planned</p>
              <p className="text-sm font-black text-gray-900 tabular-nums">
                {fba.plannedQty > 0 ? fba.plannedQty : '—'}
              </p>
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-xs font-black text-gray-400 uppercase tracking-wider">Scanned</p>
              <p className="text-sm font-black text-gray-900 tabular-nums">
                {fba.combinedPackScannedQty}
              </p>
            </div>
          </div>
        </div>

        {/* Short-pick warning banner — only when scanned < planned */}
        {fbaIsShort && !compact && (
          <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-800">
              Short — {fba.combinedPackScannedQty} of {fba.plannedQty} scanned. Confirming will ask for a reason.
            </p>
          </div>
        )}

        {/* Action buttons */}
        {!compact && (
          <div className="px-4 pb-4 space-y-2">
            <button
              type="button"
              onClick={handleFbaConfirmPress}
              className={`w-full h-[52px] rounded-2xl text-white text-[12px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
                fbaIsShort ? 'bg-amber-600 active:bg-amber-700' : config.confirmBtn
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {fbaIsShort ? 'Confirm short pack…' : 'Yes, Looks Right'}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="w-full h-[48px] rounded-2xl bg-gray-100 text-gray-700 text-[12px] font-black uppercase tracking-wider active:bg-gray-200 transition-colors"
            >
              No, Rescan
            </button>
          </div>
        )}
        <ShortPickSheet
          open={shortSheetOpen}
          onClose={() => setShortSheetOpen(false)}
          pickedQty={fba.combinedPackScannedQty}
          plannedQty={fba.plannedQty}
          productLabel={`${fba.productTitle} · FNSKU ${getLast4(fba.fnsku)}`}
          onConfirm={handleShortPickConfirm}
        />
      </div>
    );
  }

  // ── Order / Repair / Exception variant ──
  if (!order) return null;

  const daysLate = getDaysLateNumber(order.shipByDate, order.createdAt);
  const displayShipBy = order.shipByDate || order.createdAt || null;
  const quantity = Math.max(1, order.qty);

  return (
    <div className={`rounded-2xl border-2 bg-white overflow-hidden ${config.border}`}>
      {/* Header */}
      <div className={`px-4 py-3 ${config.headerBg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          {variant === 'exception' ? (
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          ) : variant === 'repair' ? (
            <Settings className="w-4 h-4 text-orange-600" />
          ) : (
            <Package className="w-4 h-4 text-emerald-600" />
          )}
          <span className={`text-xs font-black uppercase tracking-wider ${config.headerText}`}>
            {config.label}
          </span>
        </div>
        <span className="text-[11px] font-mono font-black text-gray-700">
          #{getLast4(order.orderId)}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4">
        {!compact && (
          <p className="text-xs font-black text-gray-400 uppercase tracking-wider">
            {variant === 'exception' ? 'No matching order — pack anyway?' : 'Ready to pack?'}
          </p>
        )}

        {/* Ship-by + days late */}
        {displayShipBy && (
          <div className="flex items-center gap-3">
            <ShipByDate date={displayShipBy} showPrefix={false} showYear={false} />
            <span className={`text-[13px] font-black tabular-nums ${getDaysLateTone(daysLate)}`}>
              {daysLate > 0 ? `${daysLate}d late` : 'On time'}
            </span>
          </div>
        )}

        {/* Product title */}
        <h3 className="text-base font-black text-gray-900 leading-tight">
          <InlineQtyPrefix quantity={quantity} />
          <span className={getConditionColor(order.condition)}>{order.condition || 'No Condition'}</span>
          {' '}{stripConditionPrefix(order.productTitle, order.condition)}
        </h3>

        {/* Tracking — the headline identifier for this workflow. Last-8 in a
            larger mono so the packer can compare to the shipping label at a
            glance, with a quieter "Tracking" eyebrow above it. */}
        {order.tracking && (
          <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">
              Tracking
            </p>
            <p className="text-[15px] font-mono font-black text-gray-900 tabular-nums truncate">
              {order.tracking}
            </p>
          </div>
        )}

        {/* Detail grid — qty and condition are the next two most useful
            numbers; tracking is no longer crammed in here. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">Qty</p>
            <p className="text-sm font-bold text-gray-800">{quantity}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">Cond</p>
            <p className="text-sm font-bold text-gray-800">{order.condition || 'N/A'}</p>
          </div>
        </div>

        {/* SKU + Item # row (if available) */}
        {(order.sku || order.itemNumber) && (
          <div className="grid grid-cols-2 gap-2">
            {order.sku && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">SKU</p>
                <p className="text-[11px] font-mono font-bold text-gray-800 truncate">{getLast4(order.sku)}</p>
              </div>
            )}
            {order.itemNumber && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">Item #</p>
                <p className="text-[11px] font-bold text-gray-800 truncate">{getLast4(order.itemNumber)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!compact && (
        <div className="px-4 pb-4 space-y-2">
          <button
            type="button"
            onClick={onConfirm}
            className={`w-full h-[52px] rounded-2xl text-white text-[12px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${config.confirmBtn}`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {variant === 'exception' ? 'Proceed Anyway' : 'Start Photos'}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="w-full h-[48px] rounded-2xl bg-gray-100 text-gray-700 text-[12px] font-black uppercase tracking-wider active:bg-gray-200 transition-colors"
          >
            No, Rescan
          </button>
        </div>
      )}
    </div>
  );
}
