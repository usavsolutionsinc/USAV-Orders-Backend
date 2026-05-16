'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/design-system/components';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import { Loader2, RefreshCw } from '@/components/Icons';

type ReplenishTab = 'need' | 'incoming' | 'fifo';

interface StatusCounts {
  detected: number;
  pending_review: number;
  planned_for_po: number;
  po_created: number;
  waiting_for_receipt: number;
  total_active: number;
}

const EMPTY_COUNTS: StatusCounts = {
  detected: 0,
  pending_review: 0,
  planned_for_po: 0,
  po_created: 0,
  waiting_for_receipt: 0,
  total_active: 0,
};

const TAB_ITEMS: Array<{ id: ReplenishTab; label: string; color: 'red' | 'blue' | 'emerald' }> = [
  { id: 'need', label: 'Need to Order', color: 'red' },
  { id: 'incoming', label: 'Incoming', color: 'blue' },
  { id: 'fifo', label: 'FIFO Restock', color: 'emerald' },
];

const PIPELINE_ITEMS: Array<{ key: keyof Omit<StatusCounts, 'total_active'>; label: string; tone: 'red' | 'orange' | 'yellow' | 'purple' | 'blue' }> = [
  { key: 'detected', label: 'Detected', tone: 'red' },
  { key: 'pending_review', label: 'Review', tone: 'orange' },
  { key: 'planned_for_po', label: 'Plan PO', tone: 'yellow' },
  { key: 'po_created', label: 'PO Sent', tone: 'purple' },
  { key: 'waiting_for_receipt', label: 'Incoming', tone: 'blue' },
];

export function ReplenishSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as ReplenishTab) || 'need';
  const [localSearch, setLocalSearch] = useState(searchParams.get('sku') || '');
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS);
  const [urgentOrdersWaiting, setUrgentOrdersWaiting] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const fetchCounts = useCallback(() => {
    const statuses = ['detected', 'pending_review', 'planned_for_po', 'po_created', 'waiting_for_receipt'];
    Promise.all(
      statuses.map((status) =>
        fetch(`/api/need-to-order?status=${status}&limit=1`)
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => ({ status, count: json?.total ?? 0 }))
          .catch(() => ({ status, count: 0 }))
      )
    ).then((results) => {
      const next = { ...EMPTY_COUNTS };
      let total = 0;
      for (const r of results) {
        (next as any)[r.status] = r.count;
        total += r.count;
      }
      next.total_active = total;
      setCounts(next);
    });

    fetch(`/api/need-to-order?status=detected,pending_review&limit=200&sort=fifo`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const items = Array.isArray(json?.items) ? json.items : [];
        const waiting = items.reduce((sum: number, row: any) => {
          return sum + (Array.isArray(row.orders_waiting) ? row.orders_waiting.length : 0);
        }, 0);
        setUrgentOrdersWaiting(waiting);
      })
      .catch(() => setUrgentOrdersWaiting(0));
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => {
    window.addEventListener('dashboard-refresh', fetchCounts);
    window.addEventListener('usav-refresh-data', fetchCounts);
    return () => {
      window.removeEventListener('dashboard-refresh', fetchCounts);
      window.removeEventListener('usav-refresh-data', fetchCounts);
    };
  }, [fetchCounts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (localSearch.trim()) params.set('sku', localSearch.trim());
      else params.delete('sku');
      router.replace(`/replenish?${params.toString()}`, { scroll: false });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [localSearch, router, searchParams]);

  const updateTab = (tab: ReplenishTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    params.delete('status');
    router.replace(`/replenish?${params.toString()}`, { scroll: false });
  };

  const activeStatus = searchParams.get('status') || 'all';

  const handlePipelineChange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'all' || id === activeStatus) {
      params.delete('status');
    } else {
      params.set('status', id);
      params.set('tab', 'need');
    }
    router.replace(`/replenish?${params.toString()}`, { scroll: false });
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/qstash/replenishment/sync', { method: 'POST' });
      window.setTimeout(() => {
        fetchCounts();
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      }, 1000);
    } catch {
      // Silently fail
    } finally {
      setSyncing(false);
    }
  };

  const urgentCount = counts.detected + counts.pending_review;

  // Build slider items: "All" + each pipeline stage with counts
  const pipelineSliderItems: HorizontalSliderItem[] = [
    { id: 'all', label: 'All', count: counts.total_active, tone: 'zinc' },
    ...PIPELINE_ITEMS.map((stage) => ({
      id: stage.key,
      label: stage.label,
      count: counts[stage.key],
      tone: stage.tone,
    })),
  ];

  return (
    <div className="font-dm-sans flex h-full flex-col overflow-hidden bg-white">
      {/* Tabs */}
      <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
        <TabSwitch
          tabs={TAB_ITEMS.map((tab) => ({
            id: tab.id,
            label: tab.label,
            color: tab.color,
          }))}
          activeTab={activeTab}
          onTabChange={(id) => updateTab(id as ReplenishTab)}
        />
      </div>

      {/* Search */}
      <div className={`${sidebarHeaderRowClass} border-b border-gray-300`}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search SKU or item name…"
          variant="emerald"
          className="w-full"
        />
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* Refresh */}
        <button
          type="button"
          onClick={triggerSync}
          disabled={syncing}
          className={`h-10 w-full rounded-xl ${sectionLabel} transition-colors flex items-center justify-center gap-2 ${
            syncing
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-gray-900 text-white hover:bg-black'
          }`}
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncing ? 'Syncing Zoho…' : 'Refresh Zoho Stock'}
        </button>

        {/* Urgent banner */}
        {urgentCount > 0 && (
          <div className="mt-3 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-red-700">
                  {urgentCount} need ordering
                </p>
                <p className="text-[10px] font-bold text-red-600/70 mt-0.5">
                  {urgentOrdersWaiting} order{urgentOrdersWaiting !== 1 ? 's' : ''} blocked
                </p>
              </div>
              <div className="text-2xl font-black text-red-700 tabular-nums">
                {urgentCount}
              </div>
            </div>
          </div>
        )}

        {/* Pipeline filter — horizontal scrollable chips */}
        <HorizontalButtonSlider
          items={pipelineSliderItems}
          value={activeStatus}
          onChange={handlePipelineChange}
          variant="fba"
          size="md"
          legend="Pipeline"
          className="mt-4"
        />

        {/* Total */}
        <div className="mt-4 px-3 py-3 rounded-xl bg-gray-50 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className={`${fieldLabel} text-gray-500`}>Total Active</p>
              <p className={`${fieldLabel} text-gray-400 mt-0.5`}>across all stages</p>
            </div>
            <p className="text-2xl font-black text-gray-900 tabular-nums">
              {counts.total_active}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
