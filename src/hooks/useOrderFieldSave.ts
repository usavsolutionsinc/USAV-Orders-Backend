'use client';

import { useCallback, useRef, useState } from 'react';
import { useOrderAssignment } from '@/hooks';
import { getCurrentPSTDateKey } from '@/utils/date';

interface UseOrderFieldSaveOptions {
  orderId: number;
  initialItemNumber?: string;
  initialTrackingNumber?: string;
  onUpdate?: () => void;
}

export function useOrderFieldSave({
  orderId,
  initialItemNumber = '',
  initialTrackingNumber = '',
  onUpdate,
}: UseOrderFieldSaveOptions) {
  const orderAssignmentMutation = useOrderAssignment();
  const [isSavingOutOfStock, setIsSavingOutOfStock]   = useState(false);
  const [isSavingNotes, setIsSavingNotes]             = useState(false);
  const [isSavingShipByDate, setIsSavingShipByDate]   = useState(false);

  const isSavingInlineFieldsRef     = useRef(false);
  const lastSavedItemNumberRef      = useRef(String(initialItemNumber).trim());
  const lastSavedTrackingNumberRef  = useRef(String(initialTrackingNumber).trim());

  const resetRefs = useCallback((itemNumber: string, trackingNumber: string) => {
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

  const saveInlineFields = useCallback(async (itemNumber: string, trackingNumber: string) => {
    if (isSavingInlineFieldsRef.current) return;
    const nextItemNumber    = itemNumber.trim();
    const nextTrackingNumber = trackingNumber.trim();
    const itemChanged     = nextItemNumber     !== lastSavedItemNumberRef.current;
    const trackingChanged = nextTrackingNumber !== lastSavedTrackingNumberRef.current;
    if (!itemChanged && !trackingChanged) return;

    isSavingInlineFieldsRef.current = true;
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId,
        ...(itemChanged     ? { itemNumber: nextItemNumber }              : {}),
        ...(trackingChanged ? { shippingTrackingNumber: nextTrackingNumber } : {}),
      });
      if (itemChanged)     lastSavedItemNumberRef.current     = nextItemNumber;
      if (trackingChanged) lastSavedTrackingNumberRef.current = nextTrackingNumber;
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      isSavingInlineFieldsRef.current = false;
    }
  }, [orderId, onUpdate, orderAssignmentMutation]);

  return {
    isSavingOutOfStock,
    isSavingNotes,
    isSavingShipByDate,
    saveOutOfStock,
    saveNotes,
    saveShipByDate,
    saveInlineFields,
    resetRefs,
    orderAssignmentMutation,
  };
}
