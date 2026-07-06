'use client';

import { useCallback, useEffect, useState } from 'react';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { toPSTDateKey } from '@/utils/date';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { CustomerDetailsTab } from '../CustomerDetailsTab';
import { Button } from '@/design-system/primitives';

export function DashboardDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  mode = 'dashboard',
  actionBar: _actionBar,
  activeSection,
}: DetailsStackProps) {
  const [shipByDate, setShipByDate] = useState('');
  const [orderNumber, setOrderNumber] = useState(shipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(shipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const [isUndoing, setIsUndoing] = useState(false);
  const isCustomer = activeSection === 'customer';

  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: shipped.order_id || '',
    initialItemNumber: shipped.item_number || '',
    initialTrackingNumber: shipped.shipping_tracking_number || '',
    onUpdate,
  });

  const isValidShipByDate = (value: unknown) => {
    if (!value) return false;
    const raw = String(value).trim();
    if (!raw || /^\d+$/.test(raw)) return false;
    return !!toPSTDateKey(raw);
  };

  const toMonthDayYearCurrent = (value: string | null | undefined) => {
    if (!value) return '';
    const pstDateKey = toPSTDateKey(value);
    if (!pstDateKey) return '';
    const [year, month, day] = pstDateKey.split('-').map(Number);
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
  };

  useEffect(() => {
    const preferredDate = isValidShipByDate(shipped.ship_by_date)
      ? shipped.ship_by_date
      : shipped.created_at;
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setOrderNumber(shipped.order_id || '');
    setItemNumber(shipped.item_number || '');
    setShippingTrackingNumber(shipped.shipping_tracking_number || '');
    fieldSave.resetRefs(shipped.order_id || '', shipped.item_number || '', shipped.shipping_tracking_number || '');
  }, [
    fieldSave,
    shipped.created_at,
    shipped.id,
    shipped.item_number,
    shipped.order_id,
    shipped.ship_by_date,
    shipped.shipping_tracking_number,
  ]);

  const saveInlineFields = useCallback(async () => {
    await fieldSave.saveInlineFields(orderNumber, itemNumber, shippingTrackingNumber);
  }, [fieldSave, itemNumber, orderNumber, shippingTrackingNumber]);

  useEffect(() => {
    const handleClose = () => { void saveInlineFields(); };
    window.addEventListener('close-shipped-details' as keyof WindowEventMap, handleClose as EventListener);
    return () => window.removeEventListener('close-shipped-details' as keyof WindowEventMap, handleClose as EventListener);
  }, [saveInlineFields]);

  const handleUndo = async () => {
    setIsUndoing(true);
    try {
      const res = await fetch('/api/tech/undo-last', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking: shipped.shipping_tracking_number,
          techId: shipped.tested_by ?? shipped.tester_id ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        window.alert(data?.error || 'Failed to undo latest scan.');
        return;
      }

      onUpdate?.();
      window.dispatchEvent(new CustomEvent('tech-undo-applied', {
        detail: {
          tracking: shipped.shipping_tracking_number,
          removedSerial: data.removedSerial || null,
          serialNumbers: data.serialNumbers || [],
        },
      }));
      dispatchCloseShippedDetails();
    } catch (error) {
      console.error(error);
      window.alert('Failed to undo latest scan.');
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col pb-8 pt-4">
      <div className="flex-1 space-y-4">
        {isCustomer ? (
          <CustomerDetailsTab customerId={shipped.customer_id} />
        ) : (
          <>
            <section className="mx-8 space-y-2">
              {mode === 'tech' ? (
                <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface-card p-2">
                  <span className="text-eyebrow font-black uppercase tracking-wider text-text-soft whitespace-nowrap">Undo</span>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleUndo}
                    disabled={isUndoing}
                    className="flex-1 bg-amber-500 hover:bg-amber-600"
                  >
                    {isUndoing ? 'Undoing...' : 'Undo Last Scan'}
                  </Button>
                </div>
              ) : null}
            </section>

            <div>
              <ShippedDetailsPanelContent
                shipped={{
                  ...shipped,
                  order_id: orderNumber,
                  item_number: itemNumber,
                  shipping_tracking_number: shippingTrackingNumber,
                }}
                durationData={durationData}
                copiedAll={copiedAll}
                onCopyAll={onCopyAll}
                onUpdate={onUpdate}
                editableShippingFields={{
                  orderNumber,
                  itemNumber,
                  trackingNumber: shippingTrackingNumber,
                  shipByDate,
                  isSaving: fieldSave.isSavingInlineFields,
                  isSavingShipByDate: fieldSave.isSavingShipByDate,
                  onOrderNumberChange: setOrderNumber,
                  onItemNumberChange: setItemNumber,
                  onTrackingNumberChange: setShippingTrackingNumber,
                  onShipByDateChange: setShipByDate,
                  onBlur: () => { void saveInlineFields(); },
                  onShipByDateBlur: () => { void fieldSave.saveShipByDate(shipByDate); },
                }}
                showPackingPhotos={false}
                activeSection={activeSection}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
