'use client';

import { useState, type ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { AlertCircle, Calendar, Check, Clock, Copy, ExternalLink, Flag, Layers, Package, Star } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { WorkspaceCard } from '@/design-system/components';
import { IconButton } from '@/design-system/primitives';
import {
  getDaysLateNumber,
  getDaysLateTone,
  getDisplayShipByDate,
  stripConditionPrefix,
} from '@/utils/upnext-helpers';
import { formatMonthDay } from '@/utils/date';
import { getTrackingUrl } from '@/utils/order-links';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';
import {
  getExternalUrlByItemNumber,
  getPlatformLabelByItemNumber,
} from '@/utils/external-item-url';
import type { Order } from '@/components/station/upnext/upnext-types';

interface OrderPreviewPanelProps {
  order: Order;
  /** When set, each card section participates in a parent stagger-reveal. */
  revealItem?: Variants;
}

function RevealSection({
  revealItem,
  children,
}: {
  revealItem?: Variants;
  children: ReactNode;
}) {
  if (revealItem) {
    return <motion.div variants={revealItem}>{children}</motion.div>;
  }
  return <>{children}</>;
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
 * Condition badge classes — mirrors the sidebar `OrderCard` colorway (New →
 * yellow, Parts → amber, else → neutral) but as the canonical 3-layer house
 * chip (`bg-x-50 text-x-700 ring-x-200`) so every pill on the strip reads with
 * the same weight instead of the old flat 2-layer fills.
 */
function getConditionBadgeClasses(condition: string | null | undefined): string | null {
  const c = (condition || '').toLowerCase().trim();
  if (!c) return null;
  if (c.includes('new')) return 'bg-yellow-50 text-yellow-700 ring-yellow-200';
  if (c.includes('part')) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-surface-sunken text-text-muted ring-border-soft';
}

/**
 * Quantity badge classes — ×1 reads as neutral (gray); ×2+ grabs the eye (amber)
 * since multi-unit orders need extra care. 3-layer house chip.
 */
function getQtyBadgeClasses(quantity: number): string {
  if (quantity >= 2) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-surface-sunken text-text-muted ring-border-soft';
}

/**
 * Right-pane preview body — workspace-card structure aligned with the
 * receiving triage / unbox and testing panes.
 *
 * Layout:
 *   1. Order card — product title (no #id/channel meta; the sidebar card
 *      already shows that).
 *   2. Fulfillment card — stat strip with Status / Ship by / Urgency /
 *      Tracking / Condition / Qty.
 *   3. Out-of-stock card (if applicable).
 *
 * The Tracking cell always shows copy + external icons inline; no hover
 * gating, so the affordances are discoverable. A full-width listing CTA
 * below the order title opens the marketplace page in a new tab.
 */
export function OrderPreviewPanel({ order, revealItem }: OrderPreviewPanelProps) {
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

  const itemNumberRaw = String(order.item_number || '').trim();
  const itemNumberValue = isEmptyDisplayValue(order.item_number) ? '' : itemNumberRaw;
  const listingItemKey = itemNumberValue || String(order.sku || '').trim();
  const listingUrl = getExternalUrlByItemNumber(listingItemKey);
  const listingPlatformLabel = listingItemKey
    ? getPlatformLabelByItemNumber(listingItemKey)
    : null;

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
      <RevealSection revealItem={revealItem}>
        <WorkspaceCard label="Order" bodyClassName="px-5 pb-5 pt-3">
          <h2 className="text-xl font-bold leading-tight tracking-tight text-text-default">
            {title || 'Untitled order'}
          </h2>
          {listingUrl ? (
            <button
              type="button"
              onClick={() => window.open(listingUrl, '_blank', 'noopener,noreferrer')}
              className="ds-raw-button mt-4 inline-flex h-12 w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-600 text-white text-label font-black uppercase tracking-[0.18em] shadow-[0_6px_14px_-6px_rgba(37,99,235,0.55)] transition-transform active:scale-[0.98] active:bg-blue-700"
            >
              <ExternalLink className="h-5 w-5 shrink-0" />
              {listingPlatformLabel && listingPlatformLabel !== 'Unknown'
                ? `Open ${listingPlatformLabel} listing`
                : 'Open listing'}
            </button>
          ) : null}
        </WorkspaceCard>
      </RevealSection>

      <RevealSection revealItem={revealItem}>
        <WorkspaceCard label="Fulfillment" bodyClassName="p-0">
          <div className="flex divide-x divide-border-soft overflow-x-auto overflow-y-hidden">
            <StatCell icon={Flag} iconLabel="Status">
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </StatCell>
            <StatCell icon={Calendar} iconLabel="Ship by">
              <span className="text-sm font-bold text-text-default">{displayDate}</span>
            </StatCell>
            <StatCell icon={Clock} iconLabel="Urgency">
              <span className={`text-sm font-bold ${daysLateTone}`}>
                {daysLatePhrase}
              </span>
            </StatCell>
            <StatCell icon={Package} iconLabel="Tracking">
              {trackingNumber ? (
                <span className="inline-flex items-center gap-0.5">
                  <HoverTooltip label={trackingNumber} asChild>
                    <span className="font-mono text-sm font-bold text-text-default">
                      {getLast4(trackingNumber)}
                    </span>
                  </HoverTooltip>
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
                <span className="text-sm font-bold text-text-faint">—</span>
              )}
            </StatCell>
            <StatCell icon={Star} iconLabel="Condition">
              {order.condition && conditionBadgeClasses ? (
                <span
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-caption font-black uppercase tracking-wide ring-1 ring-inset ${conditionBadgeClasses}`}
                >
                  {order.condition}
                </span>
              ) : (
                <span className="text-sm font-bold text-text-soft">—</span>
              )}
            </StatCell>
            <StatCell icon={Layers} iconLabel="Qty">
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-label font-bold ring-1 ring-inset ${qtyBadgeClasses}`}
              >
                ×{quantity}
              </span>
            </StatCell>
          </div>
        </WorkspaceCard>
      </RevealSection>

      {hasOutOfStock ? (
        <RevealSection revealItem={revealItem}>
          <WorkspaceCard label="Out of stock" tone="red" bodyClassName="px-5 py-4">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-red-800">
                {order.out_of_stock}
              </p>
            </div>
          </WorkspaceCard>
        </RevealSection>
      ) : null}
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
    <div className="flex flex-1 min-w-fit items-center justify-start gap-2 px-3 py-2.5">
      <Icon
        className="h-3.5 w-3.5 flex-shrink-0 text-text-faint"
        aria-label={iconLabel}
      />
      <HoverTooltip label={iconLabel} asChild>
        <div className="whitespace-nowrap">
          {children}
        </div>
      </HoverTooltip>
    </div>
  );
}

interface StatusPillProps {
  tone: StatusTone;
  children: React.ReactNode;
}

function StatusPill({ tone, children }: StatusPillProps) {
  // Canonical 3-layer house chip (bg-x-50 · text-x-700 · ring-x-200) so the
  // status pill sits at the same visual weight as the condition + qty chips.
  const tones: Record<StatusTone, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    orange: 'bg-orange-50 text-orange-700 ring-orange-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    gray: 'bg-surface-sunken text-text-muted ring-border-soft',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-caption font-bold ring-1 ring-inset ${tones[tone]}`}
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
    <IconButton
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-emerald-50 hover:text-emerald-600"
      ariaLabel={ariaLabel}
      icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    />
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
    <IconButton
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      tone="accent"
      className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-faint"
      ariaLabel={ariaLabel}
      icon={<ExternalLink className="h-3 w-3" />}
    />
  );
}
