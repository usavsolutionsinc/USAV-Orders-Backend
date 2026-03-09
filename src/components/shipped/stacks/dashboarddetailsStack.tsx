'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Check, ChevronUp, ChevronDown, PackageCheck } from '@/components/Icons';
import { motion } from 'framer-motion';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { getCurrentPSTDateKey, toPSTDateKey, formatDateTimePST } from '@/lib/timezone';
import { DaysLateBadge } from '@/components/ui/DaysLateBadge';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { useDeleteOrderRow, useOrderAssignment } from '@/hooks';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { OrderStaffAssignmentButtons } from '@/components/ui/OrderStaffAssignmentButtons';
import { getActiveStaff } from '@/lib/staffCache';
import { getStaffName } from '@/utils/staff';

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

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
  const [isUndoing, setIsUndoing] = useState(false);
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);
  const [isMarkingShipped, setIsMarkingShipped] = useState(false);
  const [markShippedError, setMarkShippedError] = useState<string | null>(null);
  const [selectedMarkPackerId, setSelectedMarkPackerId] = useState<number | null>(null);
  const [markPackedAt, setMarkPackedAt] = useState<string>(toLocalDateTimeInputValue(new Date()));
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');
  const [assignedTesterId, setAssignedTesterId] = useState<number | null>((shipped as any).tester_id ?? null);
  const [assignedPackerId, setAssignedPackerId] = useState<number | null>((shipped as any).packer_id ?? null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const deleteArmTimeoutRef = useRef<number | null>(null);
  const isSavingInlineFieldsRef = useRef(false);
  const lastSavedItemNumberRef = useRef(String(shipped.item_number || '').trim());
  const lastSavedTrackingNumberRef = useRef(String(shipped.shipping_tracking_number || '').trim());
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
    setIsMarkAsShippedOpen(false);
    setIsMarkingShipped(false);
    setMarkShippedError(null);
    setMarkPackedAt(toLocalDateTimeInputValue(new Date()));
    lastSavedItemNumberRef.current = String(shipped.item_number || '').trim();
    lastSavedTrackingNumberRef.current = String(shipped.shipping_tracking_number || '').trim();
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
    getActiveStaff()
      .then((data) => {
        if (active) setStaffOptions(data);
      })
      .catch((error) => console.error('Failed to load staff options:', error));
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

  const saveInlineFields = useCallback(async () => {
    if (isSavingInlineFieldsRef.current) return;
    const nextItemNumber = itemNumber.trim();
    const nextTrackingNumber = shippingTrackingNumber.trim();
    const itemChanged = nextItemNumber !== lastSavedItemNumberRef.current;
    const trackingChanged = nextTrackingNumber !== lastSavedTrackingNumberRef.current;
    if (!itemChanged && !trackingChanged) return;

    isSavingInlineFieldsRef.current = true;
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        ...(itemChanged ? { itemNumber: nextItemNumber } : {}),
        ...(trackingChanged ? { shippingTrackingNumber: nextTrackingNumber } : {}),
      });
      if (itemChanged) lastSavedItemNumberRef.current = nextItemNumber;
      if (trackingChanged) lastSavedTrackingNumberRef.current = nextTrackingNumber;
      onUpdate?.();
    } catch (error) {
      console.error(error);
    } finally {
      isSavingInlineFieldsRef.current = false;
    }
  }, [itemNumber, onUpdate, orderAssignmentMutation, shipped.id, shippingTrackingNumber]);

  useEffect(() => {
    const handleClose = () => {
      void saveInlineFields();
    };

    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => {
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, [saveInlineFields]);

  const markAsShipped = async () => {
    setMarkShippedError(null);

    const trackingNumber = String(shippingTrackingNumber || shipped.shipping_tracking_number || '').trim();
    if (!trackingNumber) {
      setMarkShippedError('Tracking number is required before marking as shipped.');
      return;
    }
    if (!selectedMarkPackerId) {
      setMarkShippedError('Select a packer.');
      return;
    }
    const packedDate = new Date(markPackedAt);
    if (!markPackedAt || Number.isNaN(packedDate.getTime())) {
      setMarkShippedError('Provide a valid date and time.');
      return;
    }

    setIsMarkingShipped(true);
    try {
      const response = await fetch('/api/packing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber,
          photos: [],
          packerId: selectedMarkPackerId,
          timestamp: packedDate.toISOString(),
          packerName: getStaffName(selectedMarkPackerId),
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to mark order as shipped.');
      }

      setIsMarkAsShippedOpen(false);
      onUpdate?.();
    } catch (error) {
      console.error('Failed to mark order as shipped:', error);
      setMarkShippedError(error instanceof Error ? error.message : 'Failed to mark order as shipped.');
    } finally {
      setIsMarkingShipped(false);
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

  const handleLastAssignmentComplete = (
    previousTesterId: number | null,
    previousPackerId: number | null,
    nextTesterId: number | null,
    nextPackerId: number | null
  ) => {
    const wasFullyAssigned = previousTesterId != null && previousPackerId != null;
    const isFullyAssigned = nextTesterId != null && nextPackerId != null;
    if (wasFullyAssigned || !isFullyAssigned) return;

    // Defer by one tick so React can flush the cache patches and re-render
    // OrderRecordsTable with updated tester_id/packer_id before navigating.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate-dashboard-next-unassigned'));
    }, 50);
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
        <section>
          <div className="px-0 pt-1 pb-0.5 border-b border-gray-200">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
              Update Item Number
            </p>
            <div className="mt-0.5 flex items-end">
              <input
                type="text"
                value={itemNumber}
                onChange={(e) => setItemNumber(e.target.value)}
                onBlur={() => void saveInlineFields()}
                placeholder="Enter Item Number"
                className="flex-1 min-w-0 border-0 bg-transparent px-0 pb-0.5 pt-2 text-[11px] font-bold leading-none text-gray-900 outline-none focus:ring-0"
              />
            </div>
          </div>

          <div className="px-0 pt-1 pb-0.5 border-b border-gray-200">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
              Update Tracking Number
            </p>
            <div className="mt-0.5 flex items-end">
              <input
                type="text"
                value={shippingTrackingNumber}
                onChange={(e) => setShippingTrackingNumber(e.target.value)}
                onBlur={() => void saveInlineFields()}
                placeholder="Enter Tracking Number"
                className="flex-1 min-w-0 border-0 bg-transparent px-0 pb-0.5 pt-2 text-[11px] font-bold leading-none text-gray-900 outline-none focus:ring-0"
              />
            </div>
          </div>
        </section>

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
                const previousPackerId = assignedPackerId;
                const nextTesterId = staffId;
                const nextPackerId = assignedPackerId;
                const testerName = testerOptions.find((member) => member.id === staffId)?.name || null;
                setAssignmentError(null);
                setAssignedTesterId(staffId);
                try {
                  await orderAssignmentMutation.mutateAsync({
                    orderId: shipped.id,
                    testerId: staffId,
                    testerName,
                  });
                  handleLastAssignmentComplete(previousTesterId, previousPackerId, nextTesterId, nextPackerId);
                } catch (error) {
                  setAssignedTesterId(previousTesterId);
                  setAssignmentError('Failed to update tester assignment. Please try again.');
                  console.error(error);
                }
              }}
              onAssignPacker={async (staffId) => {
                if (orderAssignmentMutation.isPending) return;
                const previousTesterId = assignedTesterId;
                const previousPackerId = assignedPackerId;
                const nextTesterId = assignedTesterId;
                const nextPackerId = staffId;
                const packerName = packerOptions.find((member) => member.id === staffId)?.name || null;
                setAssignmentError(null);
                setAssignedPackerId(staffId);
                try {
                  await orderAssignmentMutation.mutateAsync({
                    orderId: shipped.id,
                    packerId: staffId,
                    packerName,
                  });
                  handleLastAssignmentComplete(previousTesterId, previousPackerId, nextTesterId, nextPackerId);
                } catch (error) {
                  setAssignedPackerId(previousPackerId);
                  setAssignmentError('Failed to update packer assignment. Please try again.');
                  console.error(error);
                }
              }}
              disabled={false}
            />
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
          onUpdate={onUpdate}
          productDetailsFirst
          showPackingPhotos={false}
          showPackingInformation={false}
          showTestingInformation={false}
          showSerialNumber={false}
        />
      </motion.div>

      <motion.section variants={itemVariants} className="mx-8 space-y-2">
        <button
          type="button"
          onClick={() => setIsMarkAsShippedOpen((prev) => !prev)}
          disabled={isMarkingShipped}
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          <PackageCheck className="w-3.5 h-3.5" />
          {isMarkingShipped ? 'Marking...' : 'Mark As Shipped'}
        </button>

        {isMarkAsShippedOpen && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-800/80 block mb-1">
                  Packer
                </span>
                <select
                  value={selectedMarkPackerId ?? ''}
                  onChange={(e) => setSelectedMarkPackerId(Number(e.target.value) || null)}
                  className="w-full h-8 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-gray-900 outline-none"
                >
                  <option value="">Select</option>
                  {packerOptions.map((packer) => (
                    <option key={packer.id} value={packer.id}>
                      {packer.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-800/80 block mb-1">
                  Date &amp; Time
                </span>
                <input
                  type="datetime-local"
                  value={markPackedAt}
                  onChange={(e) => setMarkPackedAt(e.target.value)}
                  className="w-full h-8 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-gray-900 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-gray-500 block">Packer</span>
                <p className="text-[10px] font-bold text-gray-900 truncate">
                  {selectedMarkPackerId ? getStaffName(selectedMarkPackerId) : 'N/A'}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-gray-500 block">Time</span>
                <p className="text-[10px] font-bold text-gray-900 truncate">
                  {markPackedAt ? formatDateTimePST(new Date(markPackedAt)) : 'N/A'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={markAsShipped}
              disabled={isMarkingShipped}
              className="w-full h-8 inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              {isMarkingShipped ? 'Saving...' : 'Confirm Mark As Shipped'}
            </button>

            {markShippedError && (
              <p className="text-[9px] font-bold text-red-600">{markShippedError}</p>
            )}
          </div>
        )}
      </motion.section>

      <motion.section variants={itemVariants} className="mx-8 pt-2">
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
