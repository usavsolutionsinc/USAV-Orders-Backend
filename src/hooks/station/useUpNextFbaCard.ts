'use client';

import { useState, useCallback, useMemo } from 'react';
import { getDaysLateNumber, buildFbaWorkOrderRow } from '@/utils/upnext-helpers';
import { useWorkOrderAssignment } from './useWorkOrderAssignment';
import type { FBAQueueItem } from '@/components/station/upnext/upnext-types';

function getAsinUrl(value: string | null | undefined) {
  const asin = String(value || '').trim();
  if (!asin) return null;
  return `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;
}

function getFbaExternalUrl(asin: string | null | undefined, fnsku: string | null | undefined) {
  const fromAsin = getAsinUrl(asin);
  if (fromAsin) return fromAsin;
  const f = String(fnsku || '').trim();
  if (f) return `https://www.amazon.com/s?k=${encodeURIComponent(f)}`;
  return null;
}

function getConditionLabel(value: string | null | undefined) {
  const raw = String(value || '').trim();
  const normalized = raw.toUpperCase().replace(/\s+/g, ' ');
  if (!raw || normalized === 'FBA SCAN') return 'N/A';
  return raw.replaceAll('_', ' ');
}

function getFbaConditionColor(condition: string | null | undefined) {
  const c = (condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}

function getDisplayFbaShipByDate(item: FBAQueueItem) {
  const deadlineRaw = String(item.deadline_at || '').trim();
  const dueRaw = String(item.due_date || '').trim();
  const isInvalid =
    !deadlineRaw ||
    /^\d+$/.test(deadlineRaw) ||
    Number.isNaN(new Date(deadlineRaw).getTime());
  return isInvalid ? dueRaw || null : deadlineRaw;
}

function getFbaLast4(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return 'Not available';
  return raw.slice(-4);
}

/** Strip leading condition word from the product title to avoid "NEW NEW …" duplication. */
function stripFbaConditionPrefix(title: string | null | undefined, condition: string | null | undefined) {
  const t = (title || '').trimStart();
  const c = (condition || '').trim();
  if (!t || !c) return t;
  const cNorm = c.replaceAll('_', ' ').trim();
  if (!cNorm || cNorm.toUpperCase() === 'FBA SCAN') return t;
  if (t.toLowerCase().startsWith(cNorm.toLowerCase())) {
    return t.slice(cNorm.length).trimStart();
  }
  return t;
}

interface UseUpNextFbaCardOptions {
  item: FBAQueueItem;
}

export function useUpNextFbaCard({ item }: UseUpNextFbaCardOptions) {
  const assignment = useWorkOrderAssignment();
  const [copiedAsin, setCopiedAsin] = useState(false);

  // Computed
  const displayShipBy  = getDisplayFbaShipByDate(item);
  const daysLate       = getDaysLateNumber(item.deadline_at, item.due_date);
  const qtyReady       = Number(item.actual_qty) || 0;
  const qtyExpected    = Number(item.expected_qty) || 0;
  const qtyLabel       = qtyExpected > 0 ? qtyExpected : qtyReady || 1;
  const fnsku          = String(item.fnsku || '').trim();
  const asin           = String(item.asin || '').trim();
  const asinUrl        = getFbaExternalUrl(asin, item.fnsku);
  const conditionLabel = getConditionLabel(item.condition);
  const conditionColor = getFbaConditionColor(item.condition);
  const pendingTitle   = String(item.plan_title || item.shipment_ref || '').trim();
  const fnskuLast4     = getFbaLast4(fnsku);
  const strippedTitle  = stripFbaConditionPrefix(item.product_title, item.condition);
  const workOrderRow   = useMemo(() => buildFbaWorkOrderRow(item), [item]);

  const handleCopyAsin = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!asin) return;
    try {
      await navigator.clipboard.writeText(asin);
      setCopiedAsin(true);
      window.setTimeout(() => setCopiedAsin(false), 1500);
    } catch { /* noop */ }
  }, [asin]);

  return {
    // Computed
    displayShipBy,
    daysLate,
    qtyLabel,
    fnsku,
    asin,
    asinUrl,
    conditionLabel,
    conditionColor,
    pendingTitle,
    fnskuLast4,
    strippedTitle,
    workOrderRow,

    // Copy
    copiedAsin,
    handleCopyAsin,

    // Assignment
    ...assignment,
  };
}
