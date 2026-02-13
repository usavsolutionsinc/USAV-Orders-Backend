'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Check } from '@/components/Icons';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';

export function DashboardDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate
}: DetailsStackProps) {
  const [outOfStock, setOutOfStock] = useState((shipped as any).out_of_stock || '');
  const [notes, setNotes] = useState(shipped.notes || '');
  const [shipByDate, setShipByDate] = useState(''); // MM-DD-YY
  const [isSavingOutOfStock, setIsSavingOutOfStock] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isSavingShipByDate, setIsSavingShipByDate] = useState(false);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');
  const deleteArmTimeoutRef = useRef<number | null>(null);

  const isValidShipByDate = (value: any) => {
    if (!value) return false;
    const raw = String(value).trim();
    if (!raw || /^\d+$/.test(raw)) return false;
    const parsed = new Date(raw);
    return !Number.isNaN(parsed.getTime());
  };

  const toMonthDayYearCurrent = (value: string | null | undefined) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = (date.getFullYear() % 100).toString().padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${year}`;
  };

  useEffect(() => {
    setOutOfStock((shipped as any).out_of_stock || '');
    setNotes(shipped.notes || '');
    const preferredDate = isValidShipByDate(shipped.ship_by_date)
      ? (shipped.ship_by_date as any)
      : shipped.created_at;
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setActiveInput('none');
    setIsDeleteArmed(false);
  }, [shipped.id, (shipped as any).out_of_stock, shipped.notes]);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
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
      const year = new Date().getFullYear();
      const shipByDateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: shipped.id,
          shipByDate: shipByDateValue
        })
      });
      onUpdate?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingShipByDate(false);
    }
  };

  const saveOutOfStock = async () => {
    setIsSavingOutOfStock(true);
    try {
      await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: shipped.id,
          outOfStock: outOfStock.trim()
        })
      });
      onUpdate?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingOutOfStock(false);
    }
  };

  const saveNotes = async () => {
    setIsSavingNotes(true);
    try {
      await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: shipped.id,
          notes: notes.trim()
        })
      });
      onUpdate?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingNotes(false);
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

    setIsDeletingOrder(true);
    try {
      const response = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: shipped.id })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to delete order');
      }

      onUpdate?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      window.dispatchEvent(new CustomEvent('close-shipped-details'));
    } catch (error) {
      console.error('Failed to cancel order:', error);
      window.alert('Failed to cancel order. Please try again.');
    } finally {
      setIsDeletingOrder(false);
    }
  };

  return (
    <div className="pb-8 pt-4 space-y-4">
      <section className="mx-8 space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
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

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              window.location.href = `/admin?orderId=${shipped.id}`;
            }}
            className="h-9 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black uppercase tracking-wider"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Assignment
          </button>
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

        {activeInput === 'out_of_stock' && (
          <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/40 p-3">
            <input
              value={outOfStock}
              onChange={(e) => setOutOfStock(e.target.value)}
              placeholder="What is out of stock?"
              className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveInput('none')}
                className="h-8 rounded-lg bg-white border border-orange-200 text-orange-700 text-[9px] font-black uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveOutOfStock}
                disabled={isSavingOutOfStock}
                className="h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                {isSavingOutOfStock ? 'Saving' : 'Submit'}
              </button>
            </div>
          </div>
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
      </section>

      <ShippedDetailsPanelContent
        shipped={shipped}
        durationData={durationData}
        copiedAll={copiedAll}
        onCopyAll={onCopyAll}
        productDetailsFirst
        showPackingPhotos={false}
        showPackingInformation={false}
        showTestingInformation={false}
      />

      <section className="mx-8 pt-2">
        <button
          type="button"
          onClick={cancelOrder}
          disabled={isDeletingOrder}
          className="w-full h-10 inline-flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          {isDeletingOrder ? 'Cancelling...' : isDeleteArmed ? 'Click Again To Confirm' : 'Cancel/Delete Order'}
        </button>
      </section>
    </div>
  );
}
