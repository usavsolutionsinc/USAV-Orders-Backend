'use client';

import { useEffect, useState } from 'react';
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
  const [isSavingOutOfStock, setIsSavingOutOfStock] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');

  useEffect(() => {
    setOutOfStock((shipped as any).out_of_stock || '');
    setNotes(shipped.notes || '');
    setActiveInput('none');
  }, [shipped.id, (shipped as any).out_of_stock, shipped.notes]);

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

  return (
    <div className="pb-8 pt-4 space-y-4">
      <section className="mx-8 space-y-2">
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
        showPackingPhotos={false}
        showPackingInformation={false}
        showTestingInformation={false}
      />
    </div>
  );
}
