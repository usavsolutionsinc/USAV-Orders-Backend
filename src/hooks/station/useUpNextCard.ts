'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { getTrackingUrl } from '@/utils/order-links';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';
import {
  getDisplayShipByDate,
  getDaysLateNumber,
  stripConditionPrefix,
  buildOrderWorkOrderRow,
} from '@/utils/upnext-helpers';
import { useWorkOrderAssignment } from './useWorkOrderAssignment';
import type { Order } from '@/components/station/upnext/upnext-types';

interface UseUpNextCardOptions {
  order: Order;
  effectiveTab: string;
  showMissingPartsInput: number | null;
  onMissingPartsReasonChange: (reason: string) => void;
}

export function useUpNextCard({
  order,
  effectiveTab,
  showMissingPartsInput,
  onMissingPartsReasonChange,
}: UseUpNextCardOptions) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const assignment = useWorkOrderAssignment();

  const [copiedTracking, setCopiedTracking]     = useState(false);
  const [copiedItemNumber, setCopiedItemNumber] = useState(false);

  useEffect(() => {
    if (showMissingPartsInput === order.id) {
      onMissingPartsReasonChange(String(order.out_of_stock || ''));
    }
  }, [showMissingPartsInput, order.id, order.out_of_stock, onMissingPartsReasonChange]);

  // Computed values
  const showActions    = effectiveTab !== 'stock';
  const isStockTab     = effectiveTab === 'stock';
  const hasOutOfStock  = String(order.out_of_stock || '').trim() !== '';
  const quantity       = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  const daysLate       = getDaysLateNumber(order.ship_by_date, order.created_at);
  const trackingNumber = String(order.shipping_tracking_number || '').trim();
  const itemNumberRaw  = String(order.item_number || '').trim();
  const itemNumberValue = isEmptyDisplayValue(order.item_number) ? '' : itemNumberRaw;
  const trackingUrl    = getTrackingUrl(trackingNumber);
  const displayShipByDate = getDisplayShipByDate(order);
  const strippedTitle  = stripConditionPrefix(order.product_title, order.condition);
  const workOrderRow   = useMemo(() => buildOrderWorkOrderRow(order), [order]);

  const handleCopyTracking = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackingNumber) return;
    try {
      await navigator.clipboard.writeText(trackingNumber);
      setCopiedTracking(true);
      window.setTimeout(() => setCopiedTracking(false), 1500);
    } catch { /* noop */ }
  }, [trackingNumber]);

  const handleCopyItemNumber = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!itemNumberValue) return;
    try {
      await navigator.clipboard.writeText(itemNumberValue);
      setCopiedItemNumber(true);
      window.setTimeout(() => setCopiedItemNumber(false), 1500);
    } catch { /* noop */ }
  }, [itemNumberValue]);

  return {
    // Computed
    showActions,
    isStockTab,
    hasOutOfStock,
    quantity,
    daysLate,
    trackingNumber,
    itemNumberValue,
    trackingUrl,
    displayShipByDate,
    strippedTitle,
    workOrderRow,

    // Copy state
    copiedTracking,
    copiedItemNumber,
    handleCopyTracking,
    handleCopyItemNumber,

    // External URL
    getExternalUrlByItemNumber,
    openExternalByItemNumber,

    // Assignment (spread from sub-hook)
    ...assignment,
  };
}
