'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@/components/Icons';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';

interface StaffOption {
  id: number;
  name: string;
}

interface AdminOrder {
  id: number;
  ship_by_date: string | null;
  order_id: string;
  product_title: string;
  sku: string;
  shipping_tracking_number: string | null;
  tester_id: number | null;
  packer_id: number | null;
  out_of_stock: string | null;
  notes?: string | null;
  is_shipped: boolean;
  created_at: string | null;
}

interface AdminDetailsStackProps {
  order: AdminOrder | null;
  selectedCount: number;
  testerOptions: StaffOption[];
  packerOptions: StaffOption[];
  testerName?: string | null;
  packerName?: string | null;
  bulkTesterId: number | null;
  bulkPackerId: number | null;
  onBulkTesterChange: (value: number | null) => void;
  onBulkPackerChange: (value: number | null) => void;
  onApplyBulk: () => Promise<void> | void;
  isApplyingBulk: boolean;
  onClose: () => void;
  onOrderUpdated?: () => void;
}

export function AdminDetailsStack({
  order,
  selectedCount,
  testerOptions,
  packerOptions,
  testerName,
  packerName,
  bulkTesterId,
  bulkPackerId,
  onBulkTesterChange,
  onBulkPackerChange,
  onApplyBulk,
  isApplyingBulk,
  onClose,
  onOrderUpdated
}: AdminDetailsStackProps) {
  const [outOfStock, setOutOfStock] = useState('');
  const [notes, setNotes] = useState('');
  const [shipByDate, setShipByDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const deleteArmTimeoutRef = useRef<number | null>(null);

  const toMonthDayYearCurrent = (value: string | null | undefined) => {
    if (!value) return '';
    const pstDateKey = toPSTDateKey(value);
    if (!pstDateKey) return '';
    const [year, month, day] = pstDateKey.split('-').map(Number);
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
  };

  useEffect(() => {
    setOutOfStock(order?.out_of_stock || '');
    setNotes(order?.notes || '');
    setShipByDate(toMonthDayYearCurrent(order?.ship_by_date || order?.created_at));
    setIsDeleteArmed(false);
  }, [order?.id, order?.out_of_stock, order?.notes, order?.ship_by_date, order?.created_at]);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

  const saveOrderDetails = async () => {
    if (!order) return;
    setIsSaving(true);
    try {
      const payload: any = { orderId: order.id };

      const entered = String(shipByDate || '').trim();
      if (entered) {
        const mdMatch = entered.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{2}|\d{4}))?$/);
        if (mdMatch) {
          const month = Number(mdMatch[1]);
          const day = Number(mdMatch[2]);
          if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const year = Number(getCurrentPSTDateKey().slice(0, 4));
            payload.shipByDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }
        }
      }

      payload.outOfStock = outOfStock.trim();
      payload.notes = notes.trim();

      const response = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to save order updates');
      }

      onOrderUpdated?.();
    } catch (error) {
      console.error('Failed to save admin order updates:', error);
      window.alert('Failed to save order updates. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteOrder = async () => {
    if (!order) return;

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
    setIsDeletingOrder(true);

    try {
      const response = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id })
      });

      if (!response.ok) {
        throw new Error('Failed to delete order');
      }

      onOrderUpdated?.();
    } catch (error) {
      console.error('Failed to delete order:', error);
      window.alert('Failed to delete order. Please try again.');
    } finally {
      setIsDeletingOrder(false);
    }
  };

  return (
    <aside className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[120] overflow-y-auto no-scrollbar">
      <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 p-6 flex items-center justify-between z-10">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.24em] text-gray-500">Admin Details</p>
          <p className="mt-1 text-sm font-black text-gray-900">{selectedCount} order{selectedCount === 1 ? '' : 's'} selected</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-50 rounded-xl border border-transparent hover:border-gray-100"
          aria-label="Close panel"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="p-5 space-y-4">
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-gray-500">Bulk Assignment</p>
        <p className="mt-1 text-sm font-black text-gray-900">{selectedCount} order{selectedCount === 1 ? '' : 's'} selected</p>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Tester</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onBulkTesterChange(null)}
            className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
              bulkTesterId === null
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
            }`}
          >
            No Change
          </button>
          {testerOptions.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => onBulkTesterChange(member.id)}
              className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                bulkTesterId === member.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {member.name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Packer</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onBulkPackerChange(null)}
            className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
              bulkPackerId === null
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
            }`}
          >
            No Change
          </button>
          {packerOptions.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => onBulkPackerChange(member.id)}
              className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                bulkPackerId === member.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {member.name}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onApplyBulk}
        disabled={selectedCount === 0 || isApplyingBulk || (bulkTesterId === null && bulkPackerId === null)}
        className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
      >
        <Check className="w-3 h-3" />
        {isApplyingBulk ? 'Applying...' : 'Apply To Selected'}
      </button>

      <div className="h-px bg-gray-100" />

      <div className="space-y-2">
        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-gray-500">Selected Order Details</p>
        {!order ? (
          <p className="text-xs font-semibold text-gray-500">Select an order to edit details.</p>
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-gray-500">Order</p>
              <p className="text-sm font-black text-gray-900">#{order.order_id}</p>
              <p className="text-[11px] font-semibold text-gray-700 mt-1 line-clamp-2">{order.product_title}</p>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Ship By Date</label>
              <input
                type="text"
                value={shipByDate}
                onChange={(e) => setShipByDate(e.target.value)}
                placeholder="MM-DD-YY"
                maxLength={8}
                className="w-full h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Tester</p>
                <p className="text-xs font-black text-gray-900 mt-1">{testerName || 'Unassigned'}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Packer</p>
                <p className="text-xs font-black text-gray-900 mt-1">{packerName || 'Unassigned'}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Out Of Stock</label>
              <input
                value={outOfStock}
                onChange={(e) => setOutOfStock(e.target.value)}
                placeholder="What is out of stock?"
                className="w-full h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add notes..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <button
              type="button"
              onClick={saveOrderDetails}
              disabled={isSaving}
              className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {isSaving ? 'Saving...' : 'Save Order'}
            </button>

            <button
              type="button"
              onClick={deleteOrder}
              disabled={isDeletingOrder}
              className="w-full h-10 inline-flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              {isDeletingOrder ? 'Deleting...' : isDeleteArmed ? 'Click Again To Confirm' : 'Delete Order'}
            </button>
          </>
        )}
      </div>
      </div>
    </aside>
  );
}
