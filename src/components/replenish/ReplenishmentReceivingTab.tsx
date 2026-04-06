'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { sectionLabel, fieldLabel, tableHeader } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { type ReceivingLineRow, workflowStatusColor, numText } from './replenish-types';

interface ReplenishmentReceivingTabProps {
  skuSearch: string;
}

export function ReplenishmentReceivingTab({ skuSearch }: ReplenishmentReceivingTabProps) {
  const queryKey = ['replenish-receiving', { skuSearch }] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' });
      if (skuSearch) params.set('sku', skuSearch);
      const res = await fetch(`/api/replenish/receiving-lines?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load receiving lines');
      const payload = await res.json();
      return (Array.isArray(payload.lines) ? payload.lines : []) as ReceivingLineRow[];
    },
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data || [];

  if (query.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading incoming receiving lines...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={mainStickyHeaderClass}>
          <div className={mainStickyHeaderRowClass}>
            <div>
              <p className={`${sectionLabel} text-blue-700`}>Incoming · Receiving</p>
              <p className={`${fieldLabel} mt-0.5`}>
                {rows.length} receiving line{rows.length !== 1 ? 's' : ''} linked to replenishment POs
              </p>
            </div>
            <div className="min-w-[18px] flex items-center justify-end">
              {(query.isFetching && !query.isLoading) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                <p className="text-gray-500 font-semibold italic opacity-40">
                  {skuSearch
                    ? `No incoming lines match "${skuSearch}"`
                    : 'No receiving lines linked to active replenishment POs'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {rows.map((row) => (
                <div key={row.id} className="px-4 py-3 hover:bg-gray-50/60 transition-colors">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_90px_90px_120px_110px_110px] gap-3 items-start">
                    {/* Item info */}
                    <div className="min-w-0">
                      <p className="text-[12px] font-black text-gray-900 truncate">
                        {row.item_name || 'Unknown Item'}
                      </p>
                      <p className={`${fieldLabel} mt-0.5 truncate`}>
                        {row.sku || 'No SKU'}
                        {row.receiving_tracking_number && ` · ${row.carrier || ''} ${row.receiving_tracking_number}`}
                      </p>
                    </div>

                    {/* Expected */}
                    <div className="text-[10px] font-black text-gray-700">
                      <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Expected</p>
                      <p className="mt-1">{numText(row.quantity_expected)}</p>
                    </div>

                    {/* Received */}
                    <div className="text-[10px] font-black text-gray-700">
                      <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Received</p>
                      <p className={`mt-1 ${row.quantity_received >= row.quantity_expected ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {numText(row.quantity_received)}
                      </p>
                    </div>

                    {/* PO # */}
                    <div className="text-[10px] font-black text-gray-700 min-w-0">
                      <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>PO #</p>
                      <p className="mt-1 truncate">{row.zoho_po_number || '—'}</p>
                    </div>

                    {/* Workflow status */}
                    <div>
                      <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${workflowStatusColor(row.workflow_status)}`}>
                        {row.workflow_status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* QA status */}
                    <div>
                      <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                        row.qa_status === 'PASSED'
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                          : row.qa_status === 'PENDING'
                            ? 'bg-gray-100 text-gray-600 border-gray-200'
                            : 'bg-red-100 text-red-700 border-red-200'
                      }`}>
                        QA: {row.qa_status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
