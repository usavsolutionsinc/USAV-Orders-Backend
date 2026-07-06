'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrderAssignment } from './useOrderAssignment';
import { getCurrentPSTDateKey } from '@/utils/date';

interface UseOrderFieldSaveOptions {
  orderId: number;
  initialOrderNumber?: string;
  initialItemNumber?: string;
  initialTrackingNumber?: string;
  onUpdate?: () => void;
}

function patchOrderFieldInCaches(current: unknown, orderId: number, patch: Record<string, unknown>) {
  if (!current) return current;

  const normalizedPatch = { ...patch };
  if ('outOfStock' in patch) {
    normalizedPatch.out_of_stock = patch.outOfStock;
  }

  const patchRow = (row: Record<string, unknown> | null | undefined) => {
    if (!row || Number(row.id) !== orderId) return row;
    return { ...row, ...normalizedPatch };
  };

  if (Array.isArray(current)) {
    return current.map((row) => patchRow(row as Record<string, unknown>));
  }

  if (current && typeof current === 'object') {
    const record = current as Record<string, unknown>;
    if (Array.isArray(record.orders)) {
      return { ...record, orders: record.orders.map((row) => patchRow(row as Record<string, unknown>)) };
    }
    if (Array.isArray(record.results)) {
      return { ...record, results: record.results.map((row) => patchRow(row as Record<string, unknown>)) };
    }
    if (Array.isArray(record.shipped)) {
      return { ...record, shipped: record.shipped.map((row) => patchRow(row as Record<string, unknown>)) };
    }
  }

  return current;
}

export function useOrderFieldSave({
  orderId,
  initialOrderNumber = '',
  initialItemNumber = '',
  initialTrackingNumber = '',
  onUpdate,
}: UseOrderFieldSaveOptions) {
  const queryClient = useQueryClient();
  const orderAssignmentMutation = useOrderAssignment();
  const [isSavingOutOfStock, setIsSavingOutOfStock]   = useState(false);
  const [isSavingNotes, setIsSavingNotes]             = useState(false);
  const [isSavingShipByDate, setIsSavingShipByDate]   = useState(false);
  const [isSavingInlineFields, setIsSavingInlineFields] = useState(false);

  const isSavingInlineFieldsRef     = useRef(false);
  const lastSavedOrderNumberRef     = useRef(String(initialOrderNumber).trim());
  const lastSavedItemNumberRef      = useRef(String(initialItemNumber).trim());
  const lastSavedTrackingNumberRef  = useRef(String(initialTrackingNumber).trim());

  const resetRefs = useCallback((orderNumber: string, itemNumber: string, trackingNumber: string) => {
    lastSavedOrderNumberRef.current    = String(orderNumber).trim();
    lastSavedItemNumberRef.current     = String(itemNumber).trim();
    lastSavedTrackingNumberRef.current = String(trackingNumber).trim();
  }, []);

  const persistOrderRecordField = async (
    body: Record<string, unknown>,
    cachePatch: Record<string, unknown>,
    eventDetail: Record<string, unknown>,
    setSaving: (value: boolean) => void,
    errorLabel: string,
  ) => {
    setSaving(true);
    const cacheKeys = [['orders'], ['shipped'], ['dashboard-table']] as const;
    const snapshots: Array<{ key: readonly unknown[]; data: unknown }> = [];

    cacheKeys.forEach((key) => {
      queryClient.getQueriesData({ queryKey: key }).forEach(([queryKey, data]) => {
        snapshots.push({ key: queryKey, data });
        queryClient.setQueryData(queryKey, (current: unknown) =>
          patchOrderFieldInCaches(current, orderId, cachePatch),
        );
      });
    });

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || errorLabel);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('order-assignment-updated', {
            detail: { orderIds: [orderId], ...eventDetail },
          }),
        );
      }
      onUpdate?.();
    } catch (error) {
      snapshots.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
      console.error(error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const saveOutOfStock = async (value: string) => {
    const trimmed = value.trim();
    const outOfStockValue = trimmed || null;
    await persistOrderRecordField(
      { outOfStock: outOfStockValue },
      { outOfStock: outOfStockValue, out_of_stock: outOfStockValue },
      { outOfStock: outOfStockValue },
      setIsSavingOutOfStock,
      'Failed to save out of stock',
    );
  };

  const saveNotes = async (value: string) => {
    const trimmed = value.trim();
    const notesValue = trimmed || null;
    await persistOrderRecordField(
      { notes: notesValue },
      { notes: notesValue },
      { notes: trimmed },
      setIsSavingNotes,
      'Failed to save notes',
    );
  };

  const saveShipByDate = async (shipByDate: string) => {
    setIsSavingShipByDate(true);
    try {
      const entered = String(shipByDate || '').trim();
      const mdMatch = entered.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{2}|\d{4}))?$/);
      if (!mdMatch) return;
      const month = Number(mdMatch[1]);
      const day   = Number(mdMatch[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return;
      const year = Number(getCurrentPSTDateKey().slice(0, 4));
      const shipByDateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      await orderAssignmentMutation.mutateAsync({ orderId, shipByDate: shipByDateValue });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingShipByDate(false);
    }
  };

  const saveInlineFields = useCallback(async (orderNumber: string, itemNumber: string, trackingNumber: string) => {
    if (isSavingInlineFieldsRef.current) return;
    const nextOrderNumber = orderNumber.trim();
    const nextItemNumber    = itemNumber.trim();
    const nextTrackingNumber = trackingNumber.trim();
    const orderChanged    = nextOrderNumber    !== lastSavedOrderNumberRef.current;
    const itemChanged     = nextItemNumber     !== lastSavedItemNumberRef.current;
    const trackingChanged = nextTrackingNumber !== lastSavedTrackingNumberRef.current;
    if (!orderChanged && !itemChanged && !trackingChanged) return;

    isSavingInlineFieldsRef.current = true;
    setIsSavingInlineFields(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId,
        ...(orderChanged    ? { orderNumber: nextOrderNumber }             : {}),
        ...(itemChanged     ? { itemNumber: nextItemNumber }              : {}),
        ...(trackingChanged ? { shippingTrackingNumber: nextTrackingNumber } : {}),
      });
      if (orderChanged)    lastSavedOrderNumberRef.current    = nextOrderNumber;
      if (itemChanged)     lastSavedItemNumberRef.current     = nextItemNumber;
      if (trackingChanged) lastSavedTrackingNumberRef.current = nextTrackingNumber;
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      isSavingInlineFieldsRef.current = false;
      setIsSavingInlineFields(false);
    }
  }, [orderId, onUpdate, orderAssignmentMutation]);

  return {
    isSavingOutOfStock,
    isSavingNotes,
    isSavingShipByDate,
    isSavingInlineFields,
    saveOutOfStock,
    saveNotes,
    saveShipByDate,
    saveInlineFields,
    resetRefs,
    orderAssignmentMutation,
  };
}
