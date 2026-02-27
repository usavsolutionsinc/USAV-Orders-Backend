'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Check, ChevronUp, ChevronDown } from '@/components/Icons';
import { motion } from 'framer-motion';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { DaysLateBadge } from '@/components/ui/DaysLateBadge';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { useDeleteOrderRow, useOrderAssignment } from '@/hooks';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { OrderStaffAssignmentButtons } from '@/components/ui/OrderStaffAssignmentButtons';

export function DashboardDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  mode = 'dashboard',
  showAssignmentButton = true,
}: DetailsStackProps) {
  const [staffOptions, setStaffOptions] = useState<Array<{ id: number; name: string; role: string }>>([]);
  const [outOfStock, setOutOfStock] = useState((shipped as any).out_of_stock || '');
  const [notes, setNotes] = useState(shipped.notes || '');
  const [shipByDate, setShipByDate] = useState(''); // MM-DD-YY
  const [itemNumber, setItemNumber] = useState(shipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const [isSavingOutOfStock, setIsSavingOutOfStock] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isSavingShipByDate, setIsSavingShipByDate] = useState(false);
  const [isSavingItemNumber, setIsSavingItemNumber] = useState(false);
  const [isSavingTrackingNumber, setIsSavingTrackingNumber] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');
  const [assignedTesterId, setAssignedTesterId] = useState<number | null>((shipped as any).tester_id ?? null);
  const [assignedPackerId, setAssignedPackerId] = useState<number | null>((shipped as any).packer_id ?? null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const deleteArmTimeoutRef = useRef<number | null>(null);
  const hasOutOfStockValue = outOfStock.trim().length > 0;
  const orderAssignmentMutation = useOrderAssignment();
  const deleteOrderMutation = useDeleteOrderRow();
  const isDeletingOrder = deleteOrderMutation.isPending;
  const testerIdOrder = [1, 2, 3, 6];
  const packerIdOrder = [4, 5];

  const testerOptions = testerIdOrder
    .map((id) => staffOptions.find((member) => member.role === 'technician' && member.id === id))
    .filter((member): member is { id: number; name: string; role: string } => Boolean(member))
    .map((member) => ({ id: member.id, name: member.name }));
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
    setItemNumber(shipped.item_number || '');
    setShippingTrackingNumber(shipped.shipping_tracking_number || '');
    setAssignedTesterId((shipped as any).tester_id ?? null);
    setAssignedPackerId((shipped as any).packer_id ?? null);
    setAssignmentError(null);
    setActiveInput('none');
    setIsDeleteArmed(false);
  }, [shipped.id, (shipped as any).out_of_stock, shipped.notes, shipped.shipping_tracking_number, shipped.item_number]);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const fetchStaff = async () => {
      try {
        const res = await fetch('/api/staff?active=true', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !Array.isArray(data)) return;
        setStaffOptions(
          data.map((member: any) => ({
            id: Number(member.id),
            name: String(member.name || ''),
            role: String(member.role || ''),
          }))
        );
      } catch (error) {
        console.error('Failed to load staff options:', error);
      }
    };
    fetchStaff();
    return () => {
      active = false;
    };
  }, []);

  const saveShipByDate = async () => {
    setIsSavingShipByDate(true);
    try {
      const entered = String(shipByDate || '').trim();
      const mdMatch = entered.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{2}|\d{4}))?$/);
      if (!mdMatch) {
        setIsSavingShipByDate(false);
        return;
      }
      const month = Number(mdMatch[1]);
      const day = Number(mdMatch[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        setIsSavingShipByDate(false);
        return;
      }
      const year = Number(getCurrentPSTDateKey().slice(0, 4));
      const shipByDateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        shipByDate: shipByDateValue,
      });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingShipByDate(false);
    }
  };

  const saveOutOfStock = async () => {
    setIsSavingOutOfStock(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        outOfStock: outOfStock.trim(),
      });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingOutOfStock(false);
    }
  };

  const saveNotes = async () => {
    setIsSavingNotes(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        notes: notes.trim(),
      });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const saveShippingTrackingNumber = async () => {
    setIsSavingTrackingNumber(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        shippingTrackingNumber: shippingTrackingNumber.trim(),
      });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingTrackingNumber(false);
    }
  };

  const saveItemNumber = async () => {
    setIsSavingItemNumber(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        itemNumber: itemNumber.trim(),
      });
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingItemNumber(false);
    }
  };

  const cancelOrder = async () => {
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

    try {
      await deleteOrderMutation.mutateAsync({ rowSource: 'order', orderId: shipped.id });

      onUpdate?.();
    } catch (error) {
      console.error('Failed to cancel order:', error);
      window.alert('Failed to cancel order. Please try again.');
    }
  };

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

  const navigateToNextIfFullyAssigned = (nextTesterId: number | null, nextPackerId: number | null) => {
    if (nextTesterId == null || nextPackerId == null) return;
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate-dashboard-next-unassigned'));
    }, 80);
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
        ) : (
          <div className="flex w-full items-stretch gap-2">
            <div className="flex-1 min-w-0 h-12 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
              <DaysLateBadge
                shipByDate={shipped.ship_by_date}
                fallbackDate={shipped.created_at}
                variant="number"
              />
              <span className="text-[9px] font-black uppercase tracking-wider text-gray-500 whitespace-nowrap">Ship By Date</span>
              <input
                type="text"
                value={shipByDate}
                onChange={(e) => setShipByDate(e.target.value)}
                placeholder="MM-DD-YY"
                maxLength={8}
                className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              <button
                type="button"
                onClick={saveShipByDate}
                disabled={isSavingShipByDate}
                className="h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                {isSavingShipByDate ? 'Saving' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div className={`grid gap-2 ${showAssignmentButton ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {showAssignmentButton && (
            <button
              type="button"
              onClick={() => {
                window.location.href = `/admin?orderId=${shipped.id}`;
              }}
              className="h-9 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black uppercase tracking-wider"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Goals
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveInput(activeInput === 'out_of_stock' ? 'none' : 'out_of_stock')}
            className="h-9 inline-flex items-center justify-center rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-[9px] font-black uppercase tracking-wider"
          >
            Out Of Stock
          </button>
          <button
            type="button"
            onClick={() => setActiveInput(activeInput === 'notes' ? 'none' : 'notes')}
            className="h-9 inline-flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-700 text-[9px] font-black uppercase tracking-wider"
          >
            Notes
          </button>
        </div>
        <div className="flex items-stretch gap-2">
          <div className="flex-1">
            <OrderStaffAssignmentButtons
              layout="rows"
              testerOptions={testerOptions}
              packerOptions={packerOptions}
              testerId={assignedTesterId}
              packerId={assignedPackerId}
              onAssignTester={async (staffId) => {
                if (orderAssignmentMutation.isPending) return;
                const previousTesterId = assignedTesterId;
                const nextTesterId = staffId;
                const nextPackerId = assignedPackerId;
                setAssignmentError(null);
                setAssignedTesterId(staffId);
                try {
                  await orderAssignmentMutation.mutateAsync({
                    orderId: shipped.id,
                    testerId: staffId,
                  });
                  navigateToNextIfFullyAssigned(nextTesterId, nextPackerId);
                } catch (error) {
                  setAssignedTesterId(previousTesterId);
                  setAssignmentError('Failed to update tester assignment. Please try again.');
                  console.error(error);
                }
              }}
              onAssignPacker={async (staffId) => {
                if (orderAssignmentMutation.isPending) return;
                const previousPackerId = assignedPackerId;
                const nextTesterId = assignedTesterId;
                const nextPackerId = staffId;
                setAssignmentError(null);
                setAssignedPackerId(staffId);
                try {
                  await orderAssignmentMutation.mutateAsync({
                    orderId: shipped.id,
                    packerId: staffId,
                  });
                  navigateToNextIfFullyAssigned(nextTesterId, nextPackerId);
                } catch (error) {
                  setAssignedPackerId(previousPackerId);
                  setAssignmentError('Failed to update packer assignment. Please try again.');
                  console.error(error);
                }
              }}
              disabled={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('navigate-dashboard-order', { detail: { direction: 'up' } }))}
              className="h-8 w-9 inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              aria-label="Previous order"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('navigate-dashboard-order', { detail: { direction: 'down' } }))}
              className="h-8 w-9 inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              aria-label="Next order"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>
        {assignmentError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-700">
            {assignmentError}
          </div>
        )}

        {(activeInput === 'out_of_stock' || hasOutOfStockValue) && (
          <OutOfStockField
            value={outOfStock}
            editable
            onChange={setOutOfStock}
            onCancel={() => setActiveInput('none')}
            onSubmit={saveOutOfStock}
            isSaving={isSavingOutOfStock}
            autoFocus={activeInput === 'out_of_stock'}
          />
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
                onClick={saveNotes}
                disabled={isSavingNotes}
                className="h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                {isSavingNotes ? 'Saving' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </motion.section>

      <motion.div variants={itemVariants}>
        <ShippedDetailsPanelContent
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          productDetailsFirst
          showPackingPhotos={false}
          showPackingInformation={false}
          showTestingInformation={false}
          showSerialNumber={false}
        />
      </motion.div>

      <motion.section variants={itemVariants} className="mx-8 pt-2">
        <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3 mb-3">
          <label className="block text-[9px] font-black uppercase tracking-widest text-blue-700">
            Update Item Number
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={itemNumber}
              onChange={(e) => setItemNumber(e.target.value)}
              placeholder="Enter item number..."
              className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={saveItemNumber}
              disabled={isSavingItemNumber}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              aria-label="Update item number"
              title="Update item number"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3 mb-3">
          <label className="block text-[9px] font-black uppercase tracking-widest text-blue-700">
            Update Shipping Tracking Number
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={shippingTrackingNumber}
              onChange={(e) => setShippingTrackingNumber(e.target.value)}
              placeholder="Enter new tracking number..."
              className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={saveShippingTrackingNumber}
              disabled={isSavingTrackingNumber}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              aria-label="Update shipping tracking number"
              title="Update shipping tracking number"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={cancelOrder}
          disabled={isDeletingOrder}
          className="w-full h-10 inline-flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          {isDeletingOrder ? 'Cancelling...' : isDeleteArmed ? 'Click Again To Confirm' : 'Cancel/Delete Order'}
        </button>
      </motion.section>
    </motion.div>
  );
}
