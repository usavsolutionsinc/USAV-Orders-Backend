'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check } from '@/components/Icons';
import { motion } from 'framer-motion';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { toPSTDateKey } from '@/utils/date';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { getActiveStaff } from '@/lib/staffCache';
import { MarkAsShippedForm } from './MarkAsShippedForm';
import { DeleteOrderControl } from './DeleteOrderControl';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';

export function DashboardDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  mode = 'dashboard',
  actionBar,
  showReturnInformation = true,
}: DetailsStackProps) {
  const [staffOptions, setStaffOptions] = useState<Array<{ id: number; name: string; role: string }>>([]);
  const [outOfStock, setOutOfStock] = useState((shipped as any).out_of_stock || '');
  const [notes, setNotes] = useState(shipped.notes || '');
  const [shipByDate, setShipByDate] = useState(''); // MM-DD-YY
  const [orderNumber, setOrderNumber] = useState(shipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(shipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const [isUndoing, setIsUndoing] = useState(false);
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');
  const hasOutOfStockValue = outOfStock.trim().length > 0;
  const packerIdOrder = [4, 5];

  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: shipped.order_id || '',
    initialItemNumber: shipped.item_number || '',
    initialTrackingNumber: shipped.shipping_tracking_number || '',
    onUpdate,
  });

  const packerOptions = packerIdOrder
    .map((id) => staffOptions.find((member) => member.role === 'packer' && member.id === id))
    .filter((member): member is { id: number; name: string; role: string } => Boolean(member))
    .map((member) => ({ id: member.id, name: member.name }));

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
    setNotes(shipped.notes || '');
    const preferredDate = isValidShipByDate(shipped.ship_by_date)
      ? (shipped.ship_by_date as any)
      : shipped.created_at;
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setOrderNumber(shipped.order_id || '');
    setItemNumber(shipped.item_number || '');
    setShippingTrackingNumber(shipped.shipping_tracking_number || '');
    setActiveInput('none');
    setIsMarkAsShippedOpen(false);
    fieldSave.resetRefs(shipped.order_id || '', shipped.item_number || '', shipped.shipping_tracking_number || '');
  }, [
    shipped.id,
    shipped.order_id,
    (shipped as any).out_of_stock,
    shipped.notes,
    shipped.shipping_tracking_number,
    shipped.item_number,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => { if (active) setStaffOptions(data); })
      .catch((error) => console.error('Failed to load staff options:', error));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handlePanelAction = (e: CustomEvent<{ action?: string }>) => {
      switch (e.detail?.action) {
        case 'status':
          setIsMarkAsShippedOpen((prev) => !prev);
          break;
        case 'out_of_stock':
          setActiveInput((prev) => prev === 'out_of_stock' ? 'none' : 'out_of_stock');
          break;
        case 'notes':
          setActiveInput((prev) => prev === 'notes' ? 'none' : 'notes');
          break;
        default:
          break;
      }
    };

    window.addEventListener('shipped-panel-action' as any, handlePanelAction as any);
    return () => {
      window.removeEventListener('shipped-panel-action' as any, handlePanelAction as any);
    };
  }, []);

  const saveInlineFields = useCallback(async () => {
    await fieldSave.saveInlineFields(orderNumber, itemNumber, shippingTrackingNumber);
  }, [fieldSave, itemNumber, orderNumber, shippingTrackingNumber]);

  useEffect(() => {
    const handleClose = () => { void saveInlineFields(); };
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => window.removeEventListener('close-shipped-details' as any, handleClose as any);
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

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15, filter: 'blur(4px)' },
    visible: { 
      opacity: 1, 
      y: 0, 
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 } 
    },
  };

  return (
    <motion.div 
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="pb-8 pt-4 space-y-4"
    >
      {actionBar ? <PanelActionBar {...actionBar} /> : null}

      <motion.section variants={itemVariants} className="mx-8 space-y-2">
        {mode === 'tech' ? (
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-500 whitespace-nowrap">Undo</span>
            <button
              type="button"
              onClick={handleUndo}
              disabled={isUndoing}
              className="flex-1 h-8 inline-flex items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              {isUndoing ? 'Undoing...' : 'Undo Last Scan'}
            </button>
          </div>
        ) : null}

        {isMarkAsShippedOpen && (
          <MarkAsShippedForm
            shippingTrackingNumber={shippingTrackingNumber || shipped.shipping_tracking_number || ''}
            packerOptions={packerOptions}
            onSuccess={() => { setIsMarkAsShippedOpen(false); onUpdate?.(); }}
          />
        )}

        {(activeInput === 'out_of_stock' || hasOutOfStockValue) && (
          activeInput === 'out_of_stock' ? (
            <OutOfStockEditorBlock
              value={outOfStock}
              onChange={setOutOfStock}
              onCancel={() => {
                setOutOfStock((shipped as any).out_of_stock || '');
                setActiveInput('none');
              }}
              onSubmit={() => void fieldSave.saveOutOfStock(outOfStock)}
              autoFocus
            />
          ) : (
            <OutOfStockField value={outOfStock} />
          )
        )}

        {activeInput === 'notes' && (
          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add notes..."
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveInput('none')}
                className="h-8 rounded-lg bg-white border border-gray-200 text-gray-700 text-[9px] font-black uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
              onClick={() => void fieldSave.saveNotes(notes)}
              disabled={fieldSave.isSavingNotes}
              className="h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {fieldSave.isSavingNotes ? 'Saving' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </motion.section>

      <motion.div variants={itemVariants}>
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
        />
      </motion.div>

      <motion.section variants={itemVariants} className="mx-8 pt-2">
        <DeleteOrderControl orderId={shipped.id} onDeleted={() => onUpdate?.()} />
      </motion.section>
    </motion.div>
  );
}
