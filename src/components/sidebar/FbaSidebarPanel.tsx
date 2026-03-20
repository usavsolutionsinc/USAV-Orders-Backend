'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { FbaSidebar } from '@/components/fba/FbaSidebar';
import type { FbaSummaryRow } from '@/components/fba/types';
import { deriveFbaWorkflowMode } from '@/components/fba/types';

type FbaMode = 'ALL' | 'PACKING' | 'STOCK';
type FbaTab = 'summary' | 'labels' | 'shipped';

const MODE_LABEL: Record<FbaMode, string> = {
  ALL: 'All',
  PACKING: 'Packing',
  STOCK: 'Stock',
};

function resolveMode(rawMode: string | null, rawStatus: string | null): FbaMode {
  const mode = String(rawMode || '').toUpperCase();
  if (mode === 'ALL' || mode === 'PACKING' || mode === 'STOCK') return mode as FbaMode;
  if (mode === 'PLAN' || mode === 'TESTED') return 'STOCK';
  if (mode === 'READY_TO_GO' || mode === 'READY_TO_PRINT') return 'ALL';

  const legacyStatus = String(rawStatus || '').toUpperCase();
  if (legacyStatus === 'PLANNED') return 'STOCK';
  if (legacyStatus === 'READY_TO_GO' || legacyStatus === 'LABEL_ASSIGNED' || legacyStatus === 'SHIPPED') return 'ALL';
  return 'ALL';
}

/** SSR + first paint shell — mirrors real layout so hydration never compares against a different tree. */
function FbaSidebarPanelFallback() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={`${sidebarHeaderBandClass} flex h-11 items-center px-3`}>
        <div className="flex w-full min-w-0 items-center gap-2">
          <div
            className="relative h-8 min-w-0 flex-1 border-b-2 border-blue-200 transition-colors"
            aria-hidden
          />
          <div className="flex h-8 shrink-0 items-center">
            <div
              className="rounded-xl bg-violet-600 p-2.5 text-white opacity-90"
              aria-hidden
            >
              <Plus className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>
      <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
        <div className="h-9 w-full rounded-xl bg-gray-100" aria-hidden />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white" aria-hidden />
    </div>
  );
}

function FbaSidebarPanelInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMode = resolveMode(searchParams.get('mode'), searchParams.get('status'));
  const activeTabParam = searchParams.get('tab');
  const activeTab: FbaTab =
    activeTabParam === 'labels'
      ? 'labels'
      : activeTabParam === 'shipped'
        ? 'shipped'
        : 'summary';
  /** Empty until client sync — avoids SSR/client URL mismatch on the controlled input. */
  const [localSearch, setLocalSearch] = useState('');
  const urlHydratedRef = useRef(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [modeCounts, setModeCounts] = useState<Record<FbaMode, number>>({
    ALL: 0,
    PACKING: 0,
    STOCK: 0,
  });

  const updateFbaParams = (patch: { mode?: FbaMode; q?: string; r?: string; tab?: FbaTab }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (patch.mode !== undefined) {
      params.set('mode', patch.mode);
      params.delete('status');
    }
    if (patch.q !== undefined) {
      if (patch.q.trim()) params.set('q', patch.q.trim());
      else params.delete('q');
    }
    if (patch.tab !== undefined) {
      if (patch.tab === 'summary') params.delete('tab');
      else params.set('tab', patch.tab);
    }
    if (patch.r !== undefined) params.set('r', patch.r);
    router.replace(`/fba?${params.toString()}`);
  };

  useLayoutEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
    urlHydratedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!urlHydratedRef.current) return;
    const t = setTimeout(() => {
      const next = localSearch.trim();
      const cur = (searchParams.get('q') || '').trim();
      if (next === cur) return;
      updateFbaParams({ q: localSearch });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const loadModeCounts = useCallback(async () => {
    try {
      const q = String(searchParams.get('q') || '').trim();
      const qParam = q ? `&q=${encodeURIComponent(q)}` : '';
      const response = await fetch(`/api/fba/logs/summary?limit=500${qParam}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data?.rows)) return;
      const rows = data.rows as FbaSummaryRow[];
      const nextCounts: Record<FbaMode, number> = { ALL: 0, PACKING: 0, STOCK: 0 };
      for (const row of rows) {
        const mode = deriveFbaWorkflowMode(row);
        if (mode === 'PLAN') nextCounts.STOCK += 1;
        if (mode === 'PACKING') nextCounts.PACKING += 1;
      }
      nextCounts.ALL = nextCounts.STOCK + nextCounts.PACKING;
      setModeCounts(nextCounts);
    } catch {
      // no-op
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeTab !== 'summary') return;
    loadModeCounts();
  }, [loadModeCounts, activeTab, searchParams]);

  useEffect(() => {
    const handleRefresh = () => {
      loadModeCounts();
    };
    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);
    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
    };
  }, [loadModeCounts]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={`${sidebarHeaderBandClass} flex h-11 items-center px-3`}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search FNSKU, product, ASIN, SKU..."
          variant="blue"
          className="w-full"
          rightElement={
            <button
              type="button"
              onClick={() => setShowCreateForm((current) => !current)}
              className="rounded-xl bg-violet-600 p-2.5 text-white transition-colors hover:bg-violet-700 disabled:bg-gray-300"
              title="Add FBA items"
              aria-label="Open add FBA items form"
            >
              <Plus className="h-5 w-5" />
            </button>
          }
        />
      </div>

      <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
        <TabSwitch
          tabs={[
            { id: 'summary', label: 'Plan', color: 'gray' },
            { id: 'labels', label: 'Print', color: 'gray' },
            { id: 'shipped', label: 'Shipped', color: 'gray' },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => updateFbaParams({ tab: tab as FbaTab })}
        />
      </div>

      {activeTab === 'summary' ? (
        <div className={`${sidebarHeaderBandClass} flex h-11 items-center px-3`}>
          <TabSwitch
            tabs={[
              { id: 'ALL', label: MODE_LABEL.ALL, count: modeCounts.ALL, color: 'gray' },
              { id: 'PACKING', label: MODE_LABEL.PACKING, count: modeCounts.PACKING, color: 'orange' },
              { id: 'STOCK', label: MODE_LABEL.STOCK, count: modeCounts.STOCK, color: 'purple' },
            ]}
            activeTab={activeMode}
            onTabChange={(mode) => updateFbaParams({ mode: mode as FbaMode, tab: 'summary' })}
            className="w-full"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FbaSidebar
          onShipmentCreated={() => updateFbaParams({ r: String(Date.now()) })}
          showCreateForm={showCreateForm}
          onCreateFormChange={setShowCreateForm}
          activeMode={activeMode}
          refreshToken={Number(searchParams.get('r') || 0)}
        />
      </div>
    </div>
  );
}

/**
 * `useSearchParams()` must sit under Suspense (Next.js). This keeps SSR HTML and the
 * client’s first hydrated tree aligned and avoids dev HMR showing SearchBar vs CompactSearchInput mismatches.
 */
export function FbaSidebarPanel() {
  return (
    <Suspense fallback={<FbaSidebarPanelFallback />}>
      <FbaSidebarPanelInner />
    </Suspense>
  );
}
