'use client';

import { useCallback, useRef, useState } from 'react';
import { useOrderAssignment } from '@/hooks';
import { getCurrentPSTDateKey } from '@/utils/date';

interface UseOrderFieldSaveOptions {
  orderId: number;
  initialOrderNumber?: string;
  initialItemNumber?: string;
  initialTrackingNumber?: string;
  onUpdate?: () => void;
}

export function useOrderFieldSave({
  orderId,
  initialOrderNumber = '',
  initialItemNumber = '',
  initialTrackingNumber = '',
  onUpdate,
}: UseOrderFieldSaveOptions) {
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

  const saveOutOfStock = async (value: string) => {
    setIsSavingOutOfStock(true);
    try {
      await orderAssignmentMutation.mutateAsync({ orderId, outOfStock: value.trim() });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingOutOfStock(false);
    }
  };

  const saveNotes = async (value: string) => {
    setIsSavingNotes(true);
    try {
      await orderAssignmentMutation.mutateAsync({ orderId, notes: value.trim() });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingNotes(false);
    }
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
