'use client';

import { useState } from 'react';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { AlertCircle, Check, Copy, ExternalLink } from '@/components/Icons';
import {
  getDaysLateNumber,
  getDaysLateTone,
  getDisplayShipByDate,
  getConditionColor,
  stripConditionPrefix,
} from '@/utils/upnext-helpers';
import { getTrackingUrl } from '@/utils/order-links';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { isEmptyDisplayValue, missingItemNumberLabel } from '@/utils/empty-display-value';
import type { Order } from '@/components/station/upnext/upnext-types';

interface OrderPreviewPanelProps {
  order: Order;
}

function getLast4(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return raw.slice(-4);
}

/**
 * Format the days-late number as a human phrase so the right pane reads
 * like a sentence, not a debug log. The sidebar card keeps the bare number
 * because vertical density matters there; here we have room.
 */
function describeDaysLate(daysLate: number | null): string {
  if (daysLate === null) return 'No ship date';
  if (daysLate > 1) return `${daysLate} days late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)} days ahead`;
}

type CopyKey = 'sku' | 'item' | 'tracking';

/**
 * Right-pane preview body — replaces `ActiveStationOrderCard` for `mode='preview'`
 * on `ActiveOrderWorkspace`.
 *
 * Built for a different mental model than the active testing view: the tech is
 * deciding "do I want to start this order?", not scanning serials. So this
 * panel surfaces decision-relevant info up front (urgency, OOS, what to scan
 * if anything's missing) and keeps the listing iframe collapsed by default.
 *
 * Visual continuity with the framed sidebar card is intentional — same emerald
 * tint, same typographic anchors — so selecting a card on the left lands
 * cleanly in this view.
 */
export function OrderPreviewPanel({ order }: OrderPreviewPanelProps) {
  const [copiedKey, setCopiedKey] = useState<CopyKey | null>(null);
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();

  const quantity = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  const daysLate = getDaysLateNumber(order.ship_by_date, order.created_at);
  const daysLateTone = getDaysLateTone(daysLate);
  const daysLatePhrase = describeDaysLate(daysLate);
  const displayDate = getDisplayShipByDate(order);

  const trackingNumber = String(order.shipping_tracking_number || '').trim();
  const trackingUrl = getTrackingUrl(trackingNumber);

  const skuValue = isEmptyDisplayValue(order.sku) ? '' : String(order.sku || '').trim();
  const itemNumberRaw = String(order.item_number || '').trim();
  const itemNumberValue = isEmptyDisplayValue(order.item_number) ? '' : itemNumberRaw;
  const externalListingUrl = getExternalUrlByItemNumber(itemNumberValue);

  const hasOutOfStock = Boolean(String(order.out_of_stock || '').trim());
  const title = stripConditionPrefix(order.product_title, order.condition);

  const handleCopy = async (key: CopyKey, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch { /* noop */ }
  };

  return (
    <div className="space-y-4">
      {/* ── Hero — urgency line, then big title with qty + condition.
            Big type is the visual anchor; the rest reads as supporting context. ── */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <ShipByDate
            date={displayDate || ''}
            showPrefix={false}
            showYear={false}
            className="[&>span]:text-[15px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4 [&>svg]:text-gray-500"
          />
          <span className="text-gray-300">·</span>
          <span className={`text-[13px] font-black tracking-tight ${daysLateTone}`}>
            {daysLatePhrase}
          </span>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline gap-2 text-[12px] font-bold">
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-700">
              x{quantity}
            </span>
            {order.condition && (
              <span className={`${getConditionColor(order.condition)} font-black tracking-tight`}>
                {order.condition}
              </span>
            )}
          </div>
          <h2 className="text-[20px] font-bold leading-tight tracking-tight text-gray-900">
            {title || 'Untitled order'}
          </h2>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <PlatformExternalChip
            orderId={order.order_id}
            accountSource={order.account_source}
            canOpen={!!externalListingUrl}
            onOpen={() => openExternalByItemNumber(itemNumberValue)}
          />
          <span className="text-[11px] font-semibold text-gray-500">
            {order.account_source || 'External listing'}
          </span>
          {order.tester_name ? (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-[11px] font-semibold text-gray-500">
                Assigned to <span className="text-gray-800">{order.tester_name}</span>
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Out-of-stock callout — prominent under the hero. The dock's
            OOS button lets the tech edit; this is the read-only banner. ── */}
      {hasOutOfStock && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">
              Out of stock
            </p>
            <p className="mt-0.5 text-[13px] font-semibold leading-snug text-red-800">
              {order.out_of_stock}
            </p>
          </div>
        </div>
      )}

      {/* ── Meta strip — always visible (no chevron to expand). Three
            compact cells with copy + external affordances. ── */}
      <div className="grid grid-cols-3 gap-2">
        <MetaCell
          label="SKU"
          value={skuValue ? getLast4(skuValue) : 'N/A'}
          title={skuValue || undefined}
          monospace
          actions={
            skuValue ? (
              <CopyButton
                copied={copiedKey === 'sku'}
                onClick={() => handleCopy('sku', skuValue)}
                ariaLabel={copiedKey === 'sku' ? 'SKU copied' : 'Copy SKU'}
              />
            ) : null
          }
        />
        <MetaCell
          label="Item #"
          value={
            itemNumberValue
              ? getLast4(itemNumberValue)
              : missingItemNumberLabel(order.order_id, order.account_source)
          }
          title={itemNumberValue || undefined}
          actions={
            itemNumberValue ? (
              <>
                <CopyButton
                  copied={copiedKey === 'item'}
                  onClick={() => handleCopy('item', itemNumberValue)}
                  ariaLabel={copiedKey === 'item' ? 'Item number copied' : 'Copy item number'}
                />
                <ExternalButton
                  onClick={() => openExternalByItemNumber(itemNumberValue)}
                  disabled={!externalListingUrl}
                  ariaLabel="Open item in external page"
                />
              </>
            ) : null
          }
        />
        <MetaCell
          label="Tracking"
          value={trackingNumber ? getLast4(trackingNumber) : 'N/A'}
          title={trackingNumber || undefined}
          monospace
          actions={
            trackingNumber ? (
              <>
                <CopyButton
                  copied={copiedKey === 'tracking'}
                  onClick={() => handleCopy('tracking', trackingNumber)}
                  ariaLabel={copiedKey === 'tracking' ? 'Tracking copied' : 'Copy tracking number'}
                />
                <ExternalButton
                  onClick={() => {
                    if (trackingUrl) window.open(trackingUrl, '_blank', 'noopener,noreferrer');
                  }}
                  disabled={!trackingUrl}
                  ariaLabel="Open tracking in external tab"
                />
              </>
            ) : null
          }
        />
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

interface MetaCellProps {
  label: string;
  value: string;
  title?: string;
  monospace?: boolean;
  actions?: React.ReactNode;
}

function MetaCell({ label, value, title, monospace, actions }: MetaCellProps) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
        {label}
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <div
          className={`min-w-0 flex-1 truncate text-[13px] font-bold text-gray-900 ${
            monospace ? 'font-mono' : ''
          }`}
          title={title}
        >
          {value}
        </div>
        {actions ? <div className="flex items-center gap-0.5 flex-shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}

function CopyButton({
  copied,
  onClick,
  ariaLabel,
}: {
  copied: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
      aria-label={ariaLabel}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ExternalButton({
  onClick,
  disabled,
  ariaLabel,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
      aria-label={ariaLabel}
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );
}

