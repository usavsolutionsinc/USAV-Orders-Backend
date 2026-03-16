'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, FileText, Flag, Package, PackageCheck, Trash2, X } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { buildShippedCopyInfo } from '@/utils/copyallshipped';
import { DashboardDetailsStack } from './stacks/DashboardDetailsStack';
import { TechDetailsStack } from './stacks/TechDetailsStack';
import { PackerDetailsStack } from './stacks/PackerDetailsStack';
import { DetailsStackDurationData } from './stacks/types';
import { ShippedDetailsPanelContent } from './ShippedDetailsPanelContent';
import { QtyBadge } from '@/components/ui/QtyBadge';
import { useDeleteOrderRow } from '@/hooks';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { dispatchNavigateShippedDetails } from '@/utils/events';
import { getStaffName } from '@/utils/staff';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { toPSTDateKey } from '@/utils/date';

interface ShippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
  context?: 'dashboard' | 'shipped' | 'station' | 'packer';
}

export function ShippedDetailsPanel({
  shipped: initialShipped,
  onClose,
  onUpdate: _onUpdate,
  context = 'dashboard'
}: ShippedDetailsPanelProps) {
  const [shipped, setShipped] = useState<ShippedOrder>(initialShipped);
  const [durationData] = useState<DetailsStackDurationData>({});
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [shipByDate, setShipByDate] = useState('');
  const [orderNumber, setOrderNumber] = useState(initialShipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(initialShipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(initialShipped.shipping_tracking_number || '');
  const deleteOrderMutation = useDeleteOrderRow();
  const isDeletingOrder = deleteOrderMutation.isPending;
  const outOfStockValue = String((shipped as any).out_of_stock || '').trim();
  const hasOutOfStock = outOfStockValue !== '';
  const testedById = shipped.tested_by ?? null;
  const hasTechScan = Boolean((shipped as any).has_tech_scan);
  const statusToneClass = hasTechScan
    ? 'bg-emerald-50 text-emerald-700'
    : hasOutOfStock
      ? 'bg-red-50 text-red-700'
      : 'bg-yellow-50 text-yellow-700';
  const statusLabel = hasTechScan
    ? `Tested by ${getStaffName(testedById)}`
    : hasOutOfStock
      ? outOfStockValue
      : 'Pending';
  const statusDotClass = hasTechScan
    ? 'bg-emerald-500'
    : hasOutOfStock
      ? 'bg-red-500'
      : 'bg-yellow-400';
  const panelActions = [
    {
      label: 'Goals',
      onClick: () => { window.location.href = `/admin?orderId=${shipped.id}`; },
      icon: <Flag className="h-3.5 w-3.5" />,
      toneClassName: 'text-blue-600',
    },
    {
      label: 'Status',
      onClick: () => { window.dispatchEvent(new CustomEvent('shipped-panel-action', { detail: { action: 'status' } })); },
      icon: <PackageCheck className="h-3.5 w-3.5" />,
      toneClassName: 'text-emerald-600',
    },
    {
      label: 'Out of stock',
      onClick: () => { window.dispatchEvent(new CustomEvent('shipped-panel-action', { detail: { action: 'out_of_stock' } })); },
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      toneClassName: 'text-orange-600',
    },
    {
      label: 'Notes',
      onClick: () => { window.dispatchEvent(new CustomEvent('shipped-panel-action', { detail: { action: 'notes' } })); },
      icon: <FileText className="h-3.5 w-3.5" />,
      toneClassName: 'text-gray-600',
    },
  ];
  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: initialShipped.order_id || '',
    initialItemNumber: initialShipped.item_number || '',
    initialTrackingNumber: initialShipped.shipping_tracking_number || '',
    onUpdate: _onUpdate,
  });
  const {
    isSavingInlineFields,
    isSavingShipByDate,
    saveInlineFields: persistInlineFields,
    saveShipByDate,
    resetRefs,
  } = fieldSave;

  const toMonthDayYearCurrent = useCallback((value: string | null | undefined) => {
    if (!value) return '';
    const pstDateKey = toPSTDateKey(value);
    if (!pstDateKey) return '';
    const [year, month, day] = pstDateKey.split('-').map(Number);
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    setShipped(initialShipped);
    const preferredDate = String(initialShipped.ship_by_date || '').trim() || initialShipped.created_at || '';
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setOrderNumber(initialShipped.order_id || '');
    setItemNumber(initialShipped.item_number || '');
    setShippingTrackingNumber(initialShipped.shipping_tracking_number || '');
    resetRefs(
      initialShipped.order_id || '',
      initialShipped.item_number || '',
      initialShipped.shipping_tracking_number || ''
    );
  }, [initialShipped, resetRefs, toMonthDayYearCurrent]);

  const saveInlineFields = useCallback(async () => {
    await persistInlineFields(orderNumber, itemNumber, shippingTrackingNumber);
  }, [itemNumber, orderNumber, persistInlineFields, shippingTrackingNumber]);

  const handleCopyAll = () => {
    const allInfo = buildShippedCopyInfo(shipped);
    navigator.clipboard.writeText(allInfo);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopyOrderId = () => {
    const value = String(shipped.order_id || '').trim();
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedOrderId(true);
    setTimeout(() => setCopiedOrderId(false), 1500);
  };

  const handleDeleteOrder = async () => {
    const rowId = Number(shipped.id);
    const isExceptionRow = (shipped as any).row_source === 'exception' || rowId < 0;
    const targetId = isExceptionRow ? Math.abs(rowId) : rowId;
    if (!Number.isFinite(targetId) || targetId <= 0) return;

    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      window.setTimeout(() => setIsDeleteArmed(false), 3000);
      return;
    }

    setIsDeleteArmed(false);
    try {
      if (isExceptionRow) {
        await deleteOrderMutation.mutateAsync({ rowSource: 'exception', exceptionId: targetId });
      } else {
        await deleteOrderMutation.mutateAsync({ rowSource: 'order', orderId: targetId });
      }

      _onUpdate();
    } catch (error) {
      console.error('Failed to delete shipped order:', error);
      window.alert('Failed to permanently delete order. Please try again.');
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
      className="fixed right-0 top-0 z-[100] flex h-screen w-[420px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
    >
      <div className="shrink-0 border-b border-gray-100 bg-white/90 px-8 py-5 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                <Package className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={handleCopyOrderId}
                  className="truncate text-[20px] font-black leading-none tracking-tight text-gray-900 transition-colors hover:text-blue-700"
                  title="Click to copy order ID"
                  aria-label={`Copy order ID ${shipped.order_id}`}
                >
                  {shipped.order_id}
                </button>
                {copiedOrderId && (
                  <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600 mt-0.5">Copied</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <QtyBadge quantity={(shipped as any).quantity} />
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-black tracking-[0.04em] ${statusToneClass}`}>
                    <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
                    {statusLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-3 hover:bg-gray-50 rounded-2xl transition-all border border-transparent hover:border-gray-100"
            aria-label="Close details"
          >
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>
      </div>

      <PanelActionBar
        onClose={onClose}
        onMoveUp={() => dispatchNavigateShippedDetails('up')}
        onMoveDown={() => dispatchNavigateShippedDetails('down')}
        rightActions={panelActions}
      />

      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="pb-8 pt-4 space-y-4">
          {context === 'dashboard' ? (
            <DashboardDetailsStack
              shipped={shipped}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              showShippingTimestamp={false}
            />
          ) : context === 'station' ? (
            <TechDetailsStack
              shipped={shipped}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              showShippingTimestamp={false}
            />
          ) : context === 'packer' ? (
            <PackerDetailsStack
              shipped={shipped}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              showShippingTimestamp={false}
            />
          ) : (
            <ShippedDetailsPanelContent
              shipped={{
                ...shipped,
                order_id: orderNumber,
                item_number: itemNumber,
                shipping_tracking_number: shippingTrackingNumber,
              }}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              editableShippingFields={{
                orderNumber,
                itemNumber,
                trackingNumber: shippingTrackingNumber,
                shipByDate,
                isSaving: isSavingInlineFields,
                isSavingShipByDate,
                onOrderNumberChange: setOrderNumber,
                onItemNumberChange: setItemNumber,
                onTrackingNumberChange: setShippingTrackingNumber,
                onShipByDateChange: setShipByDate,
                onBlur: () => { void saveInlineFields(); },
                onShipByDateBlur: () => { void saveShipByDate(shipByDate); },
              }}
              showShippingTimestamp={context === 'shipped'}
            />
          )}

          {context === 'shipped' && (
            <section className="mx-8 pt-2">
              <button
                type="button"
                onClick={handleDeleteOrder}
                disabled={isDeletingOrder}
                className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeletingOrder
                  ? 'Deleting...'
                  : isDeleteArmed
                    ? 'Click Again To Confirm'
                    : 'Delete Permanently'}
              </button>
            </section>
          )}
        </div>
      </div>
    </motion.div>
  );
}
