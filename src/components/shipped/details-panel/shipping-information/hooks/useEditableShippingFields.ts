import { useCallback, useEffect, useState } from 'react';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import type { EditableShippingFields } from '../types';

/**
 * Resolves the effective editable shipping fields for the section. When the
 * caller passes `editableShippingFields`, that is used verbatim; otherwise the
 * hook owns internal state backed by `useOrderFieldSave` and keeps it in sync
 * with the incoming `shipped` record.
 */
export function useEditableShippingFields(
  shipped: ShippedOrder,
  editableShippingFields: EditableShippingFields | undefined,
  onUpdate: (() => void) | undefined,
) {
  const orderId = typeof shipped.id === 'number' ? shipped.id : Number(shipped.id);
  const [internalOrderNumber, setInternalOrderNumber] = useState(shipped.order_id || '');
  const [internalItemNumber, setInternalItemNumber] = useState(shipped.item_number || '');
  const [internalTrackingNumber, setInternalTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const [internalShipByDate, setInternalShipByDate] = useState(String(shipped.ship_by_date || '').trim().split(/[T ]/)[0] || '');
  const internalFieldSave = useOrderFieldSave({
    orderId: Number.isFinite(orderId) && orderId > 0 ? orderId : -1,
    initialOrderNumber: shipped.order_id || '',
    initialItemNumber: shipped.item_number || '',
    initialTrackingNumber: shipped.shipping_tracking_number || '',
    onUpdate,
  });
  const { resetRefs } = internalFieldSave;
  const internalOnBlur = useCallback(() => {
    void internalFieldSave.saveInlineFields(internalOrderNumber, internalItemNumber, internalTrackingNumber);
  }, [internalFieldSave, internalOrderNumber, internalItemNumber, internalTrackingNumber]);

  // Sync internal state when shipped record changes
  useEffect(() => {
    const nextOrderNumber = shipped.order_id || '';
    const nextItemNumber = shipped.item_number || '';
    const nextTrackingNumber = shipped.shipping_tracking_number || '';

    setInternalOrderNumber(nextOrderNumber);
    setInternalItemNumber(nextItemNumber);
    setInternalTrackingNumber(nextTrackingNumber);
    setInternalShipByDate(String(shipped.ship_by_date || '').trim().split(/[T ]/)[0] || '');
    resetRefs(nextOrderNumber, nextItemNumber, nextTrackingNumber);
  }, [
    resetRefs,
    shipped.id,
    shipped.item_number,
    shipped.order_id,
    shipped.ship_by_date,
    shipped.shipping_tracking_number,
  ]);

  // Resolve effective editable fields — external prop or internal state
  const ef: EditableShippingFields = editableShippingFields ?? {
    orderNumber: internalOrderNumber,
    itemNumber: internalItemNumber,
    trackingNumber: internalTrackingNumber,
    shipByDate: internalShipByDate,
    isSaving: internalFieldSave.isSavingInlineFields,
    isSavingShipByDate: internalFieldSave.isSavingShipByDate,
    onOrderNumberChange: setInternalOrderNumber,
    onItemNumberChange: setInternalItemNumber,
    onTrackingNumberChange: setInternalTrackingNumber,
    onShipByDateChange: setInternalShipByDate,
    onBlur: internalOnBlur,
    onShipByDateBlur: () => { void internalFieldSave.saveShipByDate(internalShipByDate); },
  };

  return { ef, internalFieldSave };
}
