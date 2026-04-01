'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from '@/components/Icons';
import { FbaFnskuScanToast } from '@/components/fba/sidebar/FbaFnskuScanToast';
import { SearchBar } from '@/components/ui/SearchBar';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { sidebarHeaderBandClass, sidebarHeaderControlClass } from '@/components/layout/header-shell';
import StaffSelector from '@/components/StaffSelector';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getDbTableChannelName } from '@/lib/realtime/channels';
import type { FbaPlanQueueItem } from '@/components/station/upnext/upnext-types';
import { FbaWorkspaceScanField } from '@/components/fba/sidebar/FbaWorkspaceScanField';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { useStationTheme } from '@/hooks/useStationTheme';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { FbaPairedReviewPanel } from '@/components/fba/sidebar/FbaPairedReviewPanel';
import { FbaShippedTable } from '@/components/fba/FbaShippedTable';
import { FbaActiveShipments } from '@/components/fba/sidebar/FbaActiveShipments';
import { useFbaBoardSelection } from '@/components/fba/hooks/useFbaBoardSelection';

// Match TechSidebarPanel secondary bands (header-shell uses border-gray-100)
const sidebarSubBandClass = 'shrink-0 border-b border-gray-100 bg-white';
const FBA_SHIPMENTS_DB_CHANNEL = getDbTableChannelName('public', 'fba_shipments');
const FBA_SHIPMENT_ITEMS_DB_CHANNEL = getDbTableChannelName('public', 'fba_shipment_items');
const FBA_SHIPMENT_TRACKING_DB_CHANNEL = getDbTableChannelName('public', 'fba_shipment_tracking');

type FbaTab = 'combine' | 'shipped';
type PendingPlan = FbaPlanQueueItem;
const FBA_VIEW_OPTIONS = [
  { value: 'combine', label: 'Combine' },
  { value: 'shipped', label: 'Shipped' },
] as const;

function emitOpenAddFba() {
  window.dispatchEvent(new CustomEvent('admin-fba-open-add'));
}

function emitOpenUploadFba() {
  window.dispatchEvent(new CustomEvent('admin-fba-open-upload'));
}

// ─── Admin: FNSKU catalog tools (/admin?section=fba) ─────────────────────────
function FbaCatalogSidebarFallback() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      <div className={`${sidebarSubBandClass} px-3 py-2`}>
        <div className="h-9 w-full rounded-xl bg-zinc-100" />
      </div>
      <div className="min-h-0 flex-1 space-y-2 p-3">
        <div className="h-14 rounded-lg bg-zinc-100" />
        <div className="h-14 rounded-lg bg-zinc-100" />
      </div>
    </div>
  );
}

function FbaCatalogSidebarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';

  const pushAdminParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('section', 'fba');
      mutate(next);
      const q = next.toString();
      router.replace(q ? `/admin?${q}` : '/admin');
    },
    [router, searchParams]
  );

  const updateSearch = (value: string) => {
    pushAdminParams((p) => {
      if (value.trim()) p.set('search', value.trim());
      else p.delete('search');
    });
  };

  const clearFilters = () => {
    pushAdminParams((p) => {
      p.delete('search');
    });
  };

  const actionRowClass =
    'flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-left transition-colors hover:bg-zinc-100';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      <div className={`${sidebarSubBandClass} px-3 py-2.5`}>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Catalog search
        </p>
        <SearchBar
          value={searchValue}
          onChange={updateSearch}
          onClear={() => updateSearch('')}
          placeholder="Search ASIN, SKU, or FNSKU"
          variant="blue"
          className="w-full"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Catalog actions</p>

        <button type="button" onClick={emitOpenAddFba} className={actionRowClass}>
          <span>
            <span className="block text-xs font-bold text-zinc-900">Add Catalog Row</span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">Create one FNSKU mapping manually</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600">
            <Plus className="h-4 w-4" />
          </span>
        </button>

        <button type="button" onClick={emitOpenUploadFba} className={actionRowClass}>
          <span>
            <span className="block text-xs font-bold text-zinc-900">Upload CSV</span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">Import many FNSKU mappings from a file</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 16V4m0 0-4 4m4-4 4 4M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
              />
            </svg>
          </span>
        </button>

        <button type="button" onClick={clearFilters} className={actionRowClass}>
          <span>
            <span className="block text-xs font-bold text-zinc-900">Clear search</span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">Reset the current catalog search</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600">
            <X className="h-4 w-4" />
          </span>
        </button>
      </div>

      <div className={`${sidebarSubBandClass} mt-auto px-3 py-3`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">FBA Station</p>
        <Link
          href="/fba"
          className="mt-2 flex w-full items-center justify-center rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900 transition-colors hover:bg-violet-100"
        >
          Open FBA Station
        </Link>
      </div>
    </div>
  );
}

// ─── Dashboard: /fba workspace ───────────────────────────────────────────────
function FbaWorkspaceSidebarFallback() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="h-11 bg-zinc-50" />
          <div className="h-11 bg-zinc-50" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={`${sidebarSubBandClass} px-3 py-2.5`}>
          <div className="h-24 w-full rounded-xl bg-zinc-100" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white" />
      </div>
    </div>
  );
}

function FbaWorkspaceSidebarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const staffDirectory = useActiveStaffDirectory();

  const rawTab = searchParams.get('tab');
  const activeTab: FbaTab = rawTab === 'shipped' ? 'shipped' : 'combine';

  // Board selection from table/select-mode pairing events.
  const boardSelection = useFbaBoardSelection({ includePairedSelection: true });

  // Clear selection when switching to shipped — also reset board checkboxes
  useEffect(() => {
    if (activeTab === 'shipped') {
      window.dispatchEvent(new CustomEvent('fba-board-toggle-all', { detail: 'none' }));
    }
  }, [activeTab]);

  // Board selection counts from FbaBoardTable
  const [boardSelectionCount, setBoardSelectionCount] = useState({ selected: 0, total: 0, selectedQty: 0, totalQty: 0 });
  useEffect(() => {
    const handler = (e: Event) => {
      const counts = (e as CustomEvent<{ selected: number; total: number; selectedQty: number; totalQty: number }>).detail;
      setBoardSelectionCount(counts);
    };
    window.addEventListener('fba-board-selection-count', handler);
    return () => window.removeEventListener('fba-board-selection-count', handler);
  }, []);

  const [staffIdNum] = usePersistedStaffId();
  const selectedStaffMember = staffDirectory.find((m) => m.id === staffIdNum);
  const staffName = selectedStaffMember?.name || (staffDirectory.length === 0 ? '…' : `Staff ${staffIdNum}`);
  const { theme: stationTheme } = useStationTheme({ staffId: staffIdNum });

  const [localSearch, setLocalSearch] = useState('');
  const urlHydratedRef = useRef(false);

  const [pendingPlans, setPendingPlans] = useState<PendingPlan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);

  const refreshToken = Number(searchParams.get('r') || 0);

  const updateFbaParams = useCallback(
    (patch: {
      q?: string;
      r?: string;
      tab?: FbaTab;
      draft?: string | null;
      plan?: number | null;
      main?: 'print' | 'plan' | null;
      details?: 'catalog' | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.q !== undefined) {
        if (patch.q.trim()) params.set('q', patch.q.trim());
        else params.delete('q');
      }
      if (patch.tab !== undefined) {
        if (patch.tab === 'combine') params.delete('tab');
        else params.set('tab', patch.tab);
      }
      if (patch.r !== undefined) params.set('r', patch.r);
      if (patch.draft !== undefined) {
        if (patch.draft) params.set('draft', patch.draft);
        else params.delete('draft');
      }
      if (patch.plan !== undefined) {
        if (patch.plan) {
          params.set('plan', String(patch.plan));
          params.delete('draft');
        } else {
          params.delete('plan');
        }
      }
      if (patch.main !== undefined) {
        if (patch.main === 'print') params.set('main', 'print');
        else if (patch.main === 'plan') params.set('main', 'plan');
        else params.delete('main');
      }
      if (patch.details !== undefined) {
        if (patch.details === 'catalog') params.set('details', 'catalog');
        else params.delete('details');
      }
      const q = params.toString();
      router.replace(q ? `/fba?${q}` : '/fba');
    },
    [router, searchParams]
  );

  const handleSelectAll = useCallback(() => {
    const action = boardSelectionCount.selected === boardSelectionCount.total && boardSelectionCount.total > 0
      ? 'none' : 'all';
    window.dispatchEvent(new CustomEvent('fba-board-toggle-all', { detail: action }));
  }, [boardSelectionCount]);

  useLayoutEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
    urlHydratedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!urlHydratedRef.current) return;
    if (activeTab !== 'shipped') return;
    const t = setTimeout(() => {
      const next = localSearch.trim();
      const cur = (searchParams.get('q') || '').trim();
      if (next === cur) return;
      updateFbaParams({ q: localSearch });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch, activeTab]);

  const loadPendingPlans = useCallback(async () => {
    if (activeTab === 'shipped') return;
    setPlansError(null);
    try {
      const res = await fetch('/api/fba/shipments?status=PLANNED&limit=50', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load plans');
      if (!Array.isArray(data?.shipments)) return;
      const sorted = [...data.shipments].sort((a: any, b: any) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });
      setPendingPlans(
        sorted.map((s: any) => ({
          id: s.id,
          shipment_ref: s.shipment_ref,
          due_date: s.due_date,
          total_items: Number(s.total_items) || 0,
          total_expected_qty: Number(s.total_expected_qty) || 0,
          ready_item_count: Number(s.ready_item_count ?? s.ready_items) || 0,
          shipped_item_count: Number(s.shipped_item_count ?? s.shipped_items) || 0,
          created_by_name: s.created_by_name || null,
          created_at: s.created_at,
          amazon_shipment_id: s.amazon_shipment_id ?? null,
          tracking_numbers: Array.isArray(s.tracking_numbers) ? s.tracking_numbers : [],
        }))
      );
    } catch (err: any) {
      setPlansError(err?.message || 'Could not load plans');
    }
  }, [activeTab]);

  useEffect(() => {
    void loadPendingPlans();
  }, [refreshToken, loadPendingPlans]);

  useAblyChannel(FBA_SHIPMENT_ITEMS_DB_CHANNEL, 'db.row.changed', () => {
    void loadPendingPlans();
  });

  useAblyChannel(FBA_SHIPMENTS_DB_CHANNEL, 'db.row.changed', () => {
    void loadPendingPlans();
  });

  useAblyChannel(FBA_SHIPMENT_TRACKING_DB_CHANNEL, 'db.row.changed', () => {
    void loadPendingPlans();
  });

  useEffect(() => {
    if (activeTab === 'shipped') return;
    const interval = setInterval(() => loadPendingPlans(), 60_000);
    return () => clearInterval(interval);
  }, [activeTab, loadPendingPlans]);

  useEffect(() => {
    const h = () => loadPendingPlans();
    window.addEventListener('usav-refresh-data' as any, h as any);
    window.addEventListener('dashboard-refresh' as any, h as any);
    window.addEventListener('fba-plan-created' as any, h as any);
    window.addEventListener('fba-print-shipped' as any, h as any);
    return () => {
      window.removeEventListener('usav-refresh-data' as any, h as any);
      window.removeEventListener('dashboard-refresh' as any, h as any);
      window.removeEventListener('fba-plan-created' as any, h as any);
      window.removeEventListener('fba-print-shipped' as any, h as any);
    };
  }, [loadPendingPlans]);

  const isBoard = activeTab === 'combine';
  const allBoardSelected =
    boardSelectionCount.total > 0 && boardSelectionCount.selected === boardSelectionCount.total;
  const someBoardSelected = boardSelectionCount.selected > 0;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      {/* Staff selector header */}
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-400">
          <div className="min-w-0">
            <StaffSelector
              role="all"
              variant="boxy"
              selectedStaffId={staffIdNum}
              onSelect={(id) => {
                const params = new URLSearchParams(searchParams.toString());
                params.set('staffId', String(id));
                const q = params.toString();
                router.replace(q ? `/fba?${q}` : '/fba');
              }}
            />
          </div>
          <div className="relative min-w-0">
            <ViewDropdown
              options={FBA_VIEW_OPTIONS}
              value={activeTab}
              onChange={(nextView) => updateFbaParams({ tab: nextView as FbaTab })}
              variant="boxy"
              buttonClassName={sidebarHeaderControlClass}
              optionClassName="text-[10px] font-black tracking-wider"
            />
          </div>
        </div>
      </div>

      {/* Single scroll container */}
      <div
        data-testid="fba-sidebar-scroll"
        className="min-h-0 flex-1 overflow-y-auto scrollbar-hide bg-white"
        style={{ ['--fba-sticky-top' as any]: '38px' }}
      >
        {/* Welcome + goal + scan — hidden in shipped mode */}
        {isBoard && (
          <div className={`${sidebarSubBandClass} px-3 py-2.5`}>
            <FbaWorkspaceScanField
              staffName={staffName}
              staffId={staffIdNum}
              showTrackingCard={false}
            />
          </div>
        )}

        {/* Shipped: search filter */}
        {activeTab === 'shipped' && (
          <div className={`${sidebarSubBandClass} px-3 py-2.5`}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
              Filter shipped list
            </p>
            <SearchBar
              value={localSearch}
              onChange={setLocalSearch}
              onClear={() => setLocalSearch('')}
              placeholder="FNSKU, ASIN, SKU, product…"
              variant="blue"
              className="w-full"
            />
          </div>
        )}

        {/* Select all row */}
        {isBoard && boardSelectionCount.total > 0 && (
          <div className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-gray-100 bg-white px-3 py-2">
            <PrintTableCheckbox
              checked={allBoardSelected}
              indeterminate={someBoardSelected && !allBoardSelected}
              onChange={handleSelectAll}
              stationTheme={stationTheme}
              label={allBoardSelected ? 'Deselect all' : 'Select all'}
            />
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[10px] font-black uppercase tracking-widest text-gray-600 hover:text-gray-900"
            >
              {allBoardSelected ? 'Deselect all' : 'Select all'}
            </button>
            {someBoardSelected && (
              <span className="ml-auto text-[10px] font-bold tabular-nums text-gray-400">
                {boardSelectionCount.selectedQty}
              </span>
            )}
          </div>
        )}

        {/* Selection review card */}
        {isBoard && boardSelection.length > 0 && (
          <FbaPairedReviewPanel
            selectedItems={boardSelection}
            stationTheme={stationTheme}
          />
        )}

        {/* Active shipments */}
        {isBoard && <FbaActiveShipments stationTheme={stationTheme} />}

        {activeTab === 'shipped' ? (
          <FbaShippedTable
            stationTheme={stationTheme}
            searchQuery={localSearch}
            embedded
          />
        ) : null}

        {/* Station FNSKU scan toast */}
        {isBoard && (
          <FbaFnskuScanToast pendingPlans={pendingPlans} stationTheme={stationTheme} />
        )}

        {/* Plans error banner */}
        {plansError && (
          <div className="mx-3 my-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-semibold text-red-700">
            {plansError}
          </div>
        )}

        {/* Pending shipment cards removed: combine flow is table-first only */}
      </div>
    </div>
  );
}

// ─── Public exports ──────────────────────────────────────────────────────────
export function FbaSidebarPanel() {
  return (
    <Suspense fallback={<FbaWorkspaceSidebarFallback />}>
      <FbaWorkspaceSidebarInner />
    </Suspense>
  );
}

export function AdminFbaSidebarPanel() {
  return (
    <Suspense fallback={<FbaCatalogSidebarFallback />}>
      <FbaCatalogSidebarInner />
    </Suspense>
  );
}
