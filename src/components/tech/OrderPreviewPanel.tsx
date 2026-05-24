'use client';

import { useState } from 'react';
import { AlertCircle, Calendar, Check, Clock, Copy, ExternalLink, Flag, Layers, Package, Star } from '@/components/Icons';
import {
  getDaysLateNumber,
  getDaysLateTone,
  getDisplayShipByDate,
  stripConditionPrefix,
} from '@/utils/upnext-helpers';
import { formatMonthDay } from '@/utils/date';
import { getTrackingUrl } from '@/utils/order-links';
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
 * Short urgency phrase tuned for the stat-row cell. Matches the sidebar
 * card's compact vocabulary so the same word appears in both surfaces,
 * and stays inside its cell width without truncation.
 */
function describeDaysLate(daysLate: number | null): string {
  if (daysLate === null) return 'No date';
  if (daysLate > 1) return `${daysLate}d late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)}d ahead`;
}

type StatusTone = 'emerald' | 'orange' | 'red' | 'amber' | 'gray';
function getStatusTone(order: Order, daysLate: number | null): { tone: StatusTone; label: string } {
  if (String(order.out_of_stock || '').trim()) return { tone: 'red', label: 'Out of stock' };
  if (daysLate === null) return { tone: 'gray', label: 'No date' };
  if (daysLate > 1) return { tone: 'red', label: 'Late' };
  if (daysLate === 1) return { tone: 'orange', label: 'Due today' };
  if (daysLate === 0) return { tone: 'amber', label: 'Due tomorrow' };
  return { tone: 'emerald', label: 'On track' };
}

type CopyKey = 'tracking';

/**
 * Condition badge classes — mirrors the sidebar `OrderCard` so the right
 * panel reads with the same colorway: New → yellow, Parts → brown, else →
 * neutral slate.
 */
function getConditionBadgeClasses(condition: string | null | undefined): string | null {
  const c = (condition || '').toLowerCase().trim();
  if (!c) return null;
  if (c.includes('new')) return 'bg-yellow-100 text-yellow-800';
  if (c.includes('part')) return 'bg-amber-200 text-amber-900';
  return 'bg-slate-100 text-slate-700';
}

/**
 * Quantity badge classes — mirrors the sidebar. ×1 reads as neutral (gray),
 * ×2+ grabs the eye (amber) since multi-unit orders need extra care.
 */
function getQtyBadgeClasses(quantity: number): string {
  if (quantity >= 2) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

/**
 * Right-pane preview body — Linear-style structure.
 *
 * Layout:
 *   1. Title section (no #id/channel meta — the selected sidebar card
 *      already shows that).
 *   2. Stat strip: 6 icon-on-left cells (Status / Ship by / Urgency /
 *      Tracking / Condition / Qty) in a single tinted band. Cells share
 *      the strip width via `flex-1` but never shrink below their content.
 *   3. Out-of-stock callout (if applicable).
 *
 * The Tracking cell always shows copy + external icons inline; no hover
 * gating, so the affordances are discoverable. SKU is intentionally not
 * surfaced — opening the listing externally already routes by item number.
 */
export function OrderPreviewPanel({ order }: OrderPreviewPanelProps) {
  const [copiedKey, setCopiedKey] = useState<CopyKey | null>(null);

  const quantity = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  const daysLate = getDaysLateNumber(order.ship_by_date, order.created_at);
  const daysLateTone = getDaysLateTone(daysLate);
  const daysLatePhrase = describeDaysLate(daysLate);
  // Strip the year — the sidebar and the right panel both read as "May 15".
  // Year is implied; showing it in the queue is just noise.
  const displayDate = formatMonthDay(getDisplayShipByDate(order)) || '—';
  const status = getStatusTone(order, daysLate);

  const trackingNumber = String(order.shipping_tracking_number || '').trim();
  const trackingUrl = getTrackingUrl(trackingNumber);

  const hasOutOfStock = Boolean(String(order.out_of_stock || '').trim());
  const title = stripConditionPrefix(order.product_title, order.condition);
  const conditionBadgeClasses = getConditionBadgeClasses(order.condition);
  const qtyBadgeClasses = getQtyBadgeClasses(quantity);

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
      {/* ── Title — the visual anchor. The #id / channel meta row has been
            removed since that information is already shown by the selected
            sidebar card; repeating it here only added vertical noise. ── */}
      <header className="border-b border-gray-200 pb-3">
        <h2 className="text-xl font-bold leading-tight tracking-tight text-gray-900">
          {title || 'Untitled order'}
        </h2>
      </header>

      {/* ── Summary stat row — icon-on-left, value-on-right, all in a single
            horizontal band. Cells share the row width evenly via flex-1
            (left-aligned) and never shrink below their content; horizontal
            scroll kicks in as a graceful fallback if the panel goes narrow. ── */}
      <div className="flex divide-x divide-gray-200 overflow-x-auto overflow-y-hidden rounded-lg border border-gray-200 bg-gray-50/60">
        <StatCell icon={Flag} iconLabel="Status">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </StatCell>
        <StatCell icon={Calendar} iconLabel="Ship by">
          <span className="text-sm font-bold text-gray-900">{displayDate}</span>
        </StatCell>
        <StatCell icon={Clock} iconLabel="Urgency">
          <span className={`text-sm font-bold ${daysLateTone}`}>
            {daysLatePhrase}
          </span>
        </StatCell>
        {/* Tracking — copy + external icons are always visible (no hover
            gating) so they're discoverable at a glance. */}
        <StatCell icon={Package} iconLabel="Tracking">
          {trackingNumber ? (
            <span className="inline-flex items-center gap-0.5">
              <span className="font-mono text-sm font-bold text-gray-900" title={trackingNumber}>
                {getLast4(trackingNumber)}
              </span>
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
            </span>
          ) : (
            <span className="text-sm font-bold text-gray-400">—</span>
          )}
        </StatCell>
        {/* Condition + Qty mirror the sidebar's bottom-right pair: condition
            first, then qty, with the same tonal badges so a tech's eye
            translates the sidebar row directly into the right-pane stat row. */}
        <StatCell icon={Star} iconLabel="Condition">
          {order.condition && conditionBadgeClasses ? (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-caption font-black uppercase tracking-wide ${conditionBadgeClasses}`}
            >
              {order.condition}
            </span>
          ) : (
            <span className="text-sm font-bold text-gray-500">—</span>
          )}
        </StatCell>
        <StatCell icon={Layers} iconLabel="Qty">
          <span
            className={`inline-block rounded px-1.5 py-0.5 font-mono text-label font-bold ${qtyBadgeClasses}`}
          >
            ×{quantity}
          </span>
        </StatCell>
      </div>

      {/* ── Out-of-stock callout ── */}
      {hasOutOfStock && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-micro font-black uppercase tracking-widest text-red-600">
              Out of stock
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-red-800">
              {order.out_of_stock}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

interface StatCellProps {
  icon: React.ComponentType<{ className?: string }>;
  iconLabel: string;
  children: React.ReactNode;
}

/**
 * Icon-on-left, value-on-right. Cells share the row width evenly (`flex-1`)
 * but never shrink below their content (`min-w-fit`) — so the row reads as
 * a balanced strip without forcing the longest cell to truncate. Content
 * is left-aligned for consistent rhythm across the strip.
 *
 * The icon replaces the previous text label and is visually de-emphasized
 * so the value is what the eye lands on. `iconLabel` becomes the accessible
 * name + tooltip so the label semantic isn't lost.
 */
function StatCell({ icon: Icon, iconLabel, children }: StatCellProps) {
  return (
    <div className="flex flex-1 min-w-fit items-center justify-start gap-1.5 px-2.5 py-2">
      <Icon
        className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        aria-label={iconLabel}
      />
      <div className="whitespace-nowrap" title={iconLabel}>
        {children}
      </div>
    </div>
  );
}

interface StatusPillProps {
  tone: StatusTone;
  children: React.ReactNode;
}

function StatusPill({ tone, children }: StatusPillProps) {
  const tones: Record<StatusTone, string> = {
    emerald: 'bg-emerald-100 text-emerald-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-gray-100 text-gray-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-caption font-bold ${tones[tone]}`}
    >
      {children}
    </span>
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
      className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
      aria-label={ariaLabel}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
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
      className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
      aria-label={ariaLabel}
    >
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}
