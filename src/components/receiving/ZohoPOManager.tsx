'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Loader2, Package, RefreshCw, Search, X } from '@/components/Icons';
import { type ZohoPO, type POStatus, STATUS_OPTIONS } from './zoho-po-types';
import { POListItem } from './POListItem';
import { PODetailPanel } from './PODetailPanel';

export default function ZohoPOManager() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<POStatus>('issued');
  const [search, setSearch]             = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPO, setSelectedPO]     = useState<ZohoPO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [search]);

  const { data: poList, isLoading, isFetching, refetch } = useQuery<ZohoPO[]>({
    queryKey: ['zoho-po-list', statusFilter, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ per_page: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search_text', debouncedSearch);
      const res = await fetch(`/api/zoho/purchase-orders?${params}`);
      if (!res.ok) throw new Error('Failed to fetch purchase orders');
      const json = await res.json();
      return Array.isArray(json.purchaseorders) ? json.purchaseorders : [];
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleSelectPO = useCallback(async (po: ZohoPO) => {
    if (po.line_items && po.line_items.length > 0) { setSelectedPO(po); return; }
    setDetailLoading(true);
    setSelectedPO(po);
    try {
      const res = await fetch(
        `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(po.purchaseorder_id)}`,
        
      );
      const json = await res.json();
      if (json.purchaseorder) setSelectedPO(json.purchaseorder as ZohoPO);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleReceived = useCallback((_receivingId: number) => {
    queryClient.invalidateQueries({ queryKey: ['zoho-po-list'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  }, [queryClient]);

  return (
    <div className="flex h-full w-full bg-white overflow-hidden">
      {/* ── Left: PO List ── */}
      <div className="flex flex-col w-[280px] shrink-0 border-r border-gray-100 overflow-hidden">
        <div className="px-3 pt-3 pb-2 space-y-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search POs…"
              className="w-full pl-8 pr-7 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white placeholder-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors ${
                  statusFilter === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">
            {isLoading ? 'Loading…' : `${poList?.length ?? 0} orders`}
          </span>
          <button onClick={() => refetch()} disabled={isFetching} className="text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40" title="Refresh">
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-300">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-[9px] font-black uppercase tracking-widest">Loading POs…</p>
            </div>
          ) : !poList || poList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-25">
              <Package className="w-10 h-10 mb-3" />
              <p className="text-[9px] font-black uppercase tracking-widest">
                {debouncedSearch ? 'No matching POs' : 'No purchase orders'}
              </p>
            </div>
          ) : (
            poList.map((po) => (
              <POListItem
                key={po.purchaseorder_id}
                po={po}
                selected={selectedPO?.purchaseorder_id === po.purchaseorder_id}
                onClick={() => handleSelectPO(po)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: Detail Panel ── */}
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {selectedPO ? (
            detailLoading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full gap-3 text-gray-300"
              >
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-[9px] font-black uppercase tracking-widest">Loading PO details…</p>
              </motion.div>
            ) : (
              <motion.div key={selectedPO.purchaseorder_id}
                initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18, ease: 'easeOut' }} className="h-full"
              >
                <PODetailPanel po={selectedPO} onClose={() => setSelectedPO(null)} onReceived={handleReceived} />
              </motion.div>
            )
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-4 text-center opacity-20 select-none"
            >
              <Package className="w-16 h-16" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest">Select a Purchase Order</p>
                <p className="text-[9px] mt-1 text-gray-500">Choose a PO from the list to review and receive items</p>
              </div>
              <ChevronRight className="w-5 h-5 -rotate-90 opacity-50" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
