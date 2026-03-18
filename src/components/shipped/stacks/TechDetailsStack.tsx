'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from '@/components/Icons';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';
import { ContextualManualLinkRow } from '@/components/shipped/details-panel/blocks/ContextualManualLinkRow';
import { toPSTDateKey } from '@/utils/date';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';

export function TechDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  actionBar,
}: DetailsStackProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [shipByDate, setShipByDate] = useState('');
  const [orderNumber, setOrderNumber] = useState(shipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(shipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const deleteArmTimeoutRef = useRef<number | null>(null);
  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: shipped.order_id || '',
    initialItemNumber: shipped.item_number || '',
    initialTrackingNumber: shipped.shipping_tracking_number || '',
    onUpdate,
  });

  const isValidShipByDate = (value: string | null | undefined) => {
    if (!value) return false;
    const raw = String(value).trim();
    if (!raw || /^\d+$/.test(raw)) return false;
    return !!toPSTDateKey(raw);
  };

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

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
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => window.removeEventListener('close-shipped-details' as any, handleClose as any);
  }, [saveInlineFields]);

  const deleteTechOrder = async () => {
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
      deleteArmTimeoutRef.current = window.setTimeout(() => {
        setIsDeleteArmed(false);
      }, 3000);
      return;
    }

    if (deleteArmTimeoutRef.current) {
      window.clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = null;
    }
    setIsDeleteArmed(false);

    setIsDeleting(true);
    try {
      const rowId = Number((shipped as any).tech_serial_id);
      const sourceRowId = Number((shipped as any).source_row_id);
      const sourceKind = String((shipped as any).source_kind || '');

      if (sourceKind !== 'tech_scan' && (!Number.isFinite(rowId) || rowId <= 0)) {
        throw new Error('Missing tech row id for delete');
      }

      if (sourceKind === 'tech_scan' && (!Number.isFinite(sourceRowId) || sourceRowId <= 0)) {
        throw new Error('Missing tracking scan activity id for delete');
      }

      const response = await fetch('/api/tech/delete-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId,
          sourceRowId,
          sourceKind,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete tech records');
      }

      window.dispatchEvent(new CustomEvent('tech-log-removed', {
        detail: {
          sourceKind,
          sourceRowId,
          techSerialId: rowId,
          orderDbId: shipped.id,
        },
      }));
      onUpdate?.();
      dispatchDashboardAndStationRefresh();
      dispatchCloseShippedDetails();
    } catch (error) {
      console.error('Failed to delete tech records:', error);
      window.alert('Failed to delete tech records. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="pb-8 pt-4 space-y-4">
      {actionBar ? <PanelActionBar {...actionBar} /> : null}

      <ContextualManualLinkRow
        sku={shipped.sku}
        itemNumber={itemNumber}
        allowEmbeddedItemNumberInput={false}
      />

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
        productDetailsFirst={false}
        showPackingPhotos={false}
        showPackingInformation={false}
        showTestingInformation={false}
        showSerialNumber
      />

      <section className="mx-8 pt-2">
        <button
          type="button"
          onClick={deleteTechOrder}
          disabled={isDeleting}
          className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          {isDeleting
            ? 'Deleting...'
            : isDeleteArmed
              ? 'Click Again To Confirm'
              : 'Delete Tech Order'}
        </button>
      </section>
    </div>
  );
}
