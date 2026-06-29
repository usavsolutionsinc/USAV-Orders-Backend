'use client';

import { useCallback, useEffect, useState } from 'react';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { toPSTDateKey } from '@/utils/date';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { getStaffColorHex } from '@/utils/staff-colors';
import { PACKER_IDS } from '@/utils/staff';
import type { StaffRecipient } from '@/components/quick-access/StaffRecipientList';
import { MarkAsShippedForm } from './MarkAsShippedForm';
import { DeleteOrderControl } from './DeleteOrderControl';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { CustomerDetailsTab } from '../CustomerDetailsTab';
import { ShippedNotesComposer } from '@/components/shipped/details-panel/ShippedNotesComposer';
import { Button } from '@/design-system/primitives';

export function DashboardDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  mode = 'dashboard',
  actionBar: _actionBar,
  showReturnInformation = true,
  activeSection,
  activeInput = 'none',
  setActiveInput,
  isMarkAsShippedOpen = false,
  setIsMarkAsShippedOpen,
  notes = '',
  setNotes,
  isSavingNotes = false,
  onSaveNotes,
}: DetailsStackProps) {
  const [staffOptions, setStaffOptions] = useState<StaffMember[]>([]);
  const [outOfStock, setOutOfStock] = useState((shipped as any).out_of_stock || '');
  const [shipByDate, setShipByDate] = useState(''); // MM-DD-YY
  const [orderNumber, setOrderNumber] = useState(shipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(shipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const [isUndoing, setIsUndoing] = useState(false);
  const hasOutOfStockValue = outOfStock.trim().length > 0;
  const hasSavedNotes = String(shipped.notes || '').trim().length > 0;
  const packerIdOrder = PACKER_IDS;
  const isCustomer = activeSection === 'customer';

  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: shipped.order_id || '',
    initialItemNumber: shipped.item_number || '',
    initialTrackingNumber: shipped.shipping_tracking_number || '',
    onUpdate,
  });

  // Every active staff member in the org, ordered with the preferred PACKER_IDS
  // first so the usual packers stay at the top. Shaped as StaffRecipient[] so
  // the picker can reuse the clipboard's StaffRecipientList selector.
  const packerOptions: StaffRecipient[] = staffOptions
    .slice()
    .sort((a, b) => {
      const ai = packerIdOrder.indexOf(a.id);
      const bi = packerIdOrder.indexOf(b.id);
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    })
    .map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      color_hex: getStaffColorHex({ id: member.id }),
    }));

  const isValidShipByDate = (value: any) => {
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
    setOutOfStock((shipped as any).out_of_stock || '');
    const preferredDate = isValidShipByDate(shipped.ship_by_date)
      ? (shipped.ship_by_date as any)
      : shipped.created_at;
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setOrderNumber(shipped.order_id || '');
    setItemNumber(shipped.item_number || '');
    setShippingTrackingNumber(shipped.shipping_tracking_number || '');
    fieldSave.resetRefs(shipped.order_id || '', shipped.item_number || '', shipped.shipping_tracking_number || '');
  }, [
    shipped.id,
    shipped.order_id,
    (shipped as any).out_of_stock,
    shipped.shipping_tracking_number,
    shipped.item_number,
  ]);

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => { if (active) setStaffOptions(data); })
      .catch((error) => console.error('Failed to load staff options:', error));
    return () => { active = false; };
  }, []);

  const saveInlineFields = useCallback(async () => {
    await fieldSave.saveInlineFields(orderNumber, itemNumber, shippingTrackingNumber);
  }, [fieldSave, itemNumber, orderNumber, shippingTrackingNumber]);

  const saveOutOfStockOnClose = useCallback(async () => {
    const initialOutOfStock = String((shipped as any).out_of_stock || '').trim();
    const nextOutOfStock = outOfStock.trim();
    if (nextOutOfStock === initialOutOfStock) return;
    await fieldSave.saveOutOfStock(outOfStock);
  }, [fieldSave, outOfStock, shipped]);

  useEffect(() => {
    const handleClose = () => {
      void (async () => {
        await saveOutOfStockOnClose();
        await saveInlineFields();
      })();
    };
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => window.removeEventListener('close-shipped-details' as any, handleClose as any);
  }, [saveInlineFields, saveOutOfStockOnClose]);

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
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
            <span className="text-eyebrow font-black uppercase tracking-wider text-gray-500 whitespace-nowrap">Undo</span>
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

        {isMarkAsShippedOpen && (
          <MarkAsShippedForm
            shippingTrackingNumber={shippingTrackingNumber || shipped.shipping_tracking_number || ''}
            packerOptions={packerOptions}
            onSuccess={() => { setIsMarkAsShippedOpen?.(false); onUpdate?.(); }}
          />
        )}

        {(activeInput === 'out_of_stock' || hasOutOfStockValue) && (
          activeInput === 'out_of_stock' ? (
            <OutOfStockEditorBlock
              value={outOfStock}
              onChange={setOutOfStock}
              onCancel={() => {
                setOutOfStock((shipped as any).out_of_stock || '');
                setActiveInput?.('none');
              }}
              onSubmit={() => void fieldSave.saveOutOfStock(outOfStock)}
              autoSaveOnChange={false}
              saveHint="Saves when the details panel closes."
              autoFocus
            />
          ) : (
            <OutOfStockField value={outOfStock} />
          )
        )}

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
          showPackingInformation={false}
          showTestingInformation={false}
          showReturnInformation={showReturnInformation}
          activeSection={activeSection}
        />
      </div>
       </>
      )}
      </div>

      {(activeInput === 'notes' || hasSavedNotes) && (
        activeInput === 'notes' && setNotes && onSaveNotes ? (
          <ShippedNotesComposer
            value={notes}
            onChange={setNotes}
            onCancel={() => {
              setNotes(shipped.notes || '');
              setActiveInput?.('none');
            }}
            onSubmit={onSaveNotes}
            isSaving={isSavingNotes}
          />
        ) : (
          <ShippedNotesComposer
            value={String(shipped.notes || '')}
            readOnly
            onClick={() => setActiveInput?.('notes')}
          />
        )
      )}

      <section className="mx-8 pt-2 space-y-2">
        <DeleteOrderControl
          orderId={shipped.id}
          packerLogId={(shipped as any).packer_log_id ?? null}
          stationActivityLogId={(shipped as any).station_activity_log_id ?? (shipped as any).sal_id ?? null}
          trackingType={shipped.tracking_type}
          onDeleted={() => onUpdate?.()}
        />
      </section>
    </div>
  );
}
