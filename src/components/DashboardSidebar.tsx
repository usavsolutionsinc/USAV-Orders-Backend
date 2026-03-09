'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  LayoutDashboard,
  Loader2,
  Menu,
  Package,
  RefreshCw,
  X,
} from '@/components/Icons';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/admin-sections';
import BarcodeSidebar from '@/components/BarcodeSidebar';
import { QuarterSidebar } from '@/components/QuarterSelector';
import { DashboardManagementPanel } from '@/components/sidebar/DashboardManagementPanel';
import { RepairSidebar } from '@/components/repair';
import ShippedSidebar from '@/components/ShippedSidebar';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import { UnboxingQueuePanel, type LogRow } from '@/components/ReceivingSidebar';
import { getReceivingLogs, invalidateReceivingCache } from '@/lib/receivingCache';
import { FbaSidebar } from '@/components/fba/FbaSidebar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { SearchBar } from '@/components/ui/SearchBar';
import StationTesting from '@/components/station/StationTesting';
import StationPacking from '@/components/station/StationPacking';
import { ManualsSidebar } from '@/components/manuals/ManualsSidebar';
import StaffSelector from '@/components/StaffSelector';
import {
  APP_SIDEBAR_NAV,
  getSidebarRouteKey,
  isSidebarNavActive,
  type SidebarNavItem,
} from '@/lib/sidebar-navigation';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { getPackerThemeById, getTechThemeById } from '@/utils/staff-colors';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import type { ShippedFormData } from '@/components/shipped';
import { dispatchCloseShippedDetails } from '@/utils/events';

type DashboardOrderView = 'pending' | 'unshipped' | 'shipped';

const ORDER_VIEW_OPTIONS: Array<{ value: DashboardOrderView; label: string }> = [
  { value: 'unshipped', label: 'Unshipped Orders' },
  { value: 'pending', label: 'Pending Orders' },
  { value: 'shipped', label: 'Shipped Orders' },
];

type FbaStatus = 'ALL' | 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';

const FBA_STATUS_OPTIONS: Array<{ value: FbaStatus; label: string }> = [
  { value: 'ALL',            label: 'All' },
  { value: 'PLANNED',        label: 'Planned' },
  { value: 'READY_TO_GO',    label: 'Ready to Go' },
  { value: 'LABEL_ASSIGNED', label: 'Label Assigned' },
  { value: 'SHIPPED',        label: 'Shipped' },
];

function getOrderViewFromSearch(searchParams: { has: (key: string) => boolean }): DashboardOrderView {
  if (searchParams.has('unshipped')) return 'unshipped';
  if (searchParams.has('pending')) return 'pending';
  if (searchParams.has('shipped')) return 'shipped';
  return 'pending';
}

function normalizeOrderViewParams(params: URLSearchParams, preferredView?: DashboardOrderView): DashboardOrderView {
  const nextView = preferredView ?? getOrderViewFromSearch(params);
  params.delete('unshipped');
  params.delete('pending');
  params.delete('shipped');
  params.set(nextView, '');
  return nextView;
}

type StaffMember = {
  id: number;
  name: string;
  role: string;
};

function useActiveStaffDirectory() {
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    let isMounted = true;
    const fetchStaff = async () => {
      try {
        const res = await fetch('/api/staff?active=true', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted || !Array.isArray(data)) return;
        setStaff(
          data.filter((member: any) => Number.isFinite(Number(member?.id))).map((member: any) => ({
            id: Number(member.id),
            name: String(member.name || '').trim() || `Staff ${member.id}`,
            role: String(member.role || ''),
          })),
        );
      } catch (_error) {
        // no-op
      }
    };

    fetchStaff();
    return () => {
      isMounted = false;
    };
  }, []);

  return staff;
}

function getPathStaffId(pathname: string | null, segment: 'tech' | 'packer'): string | null {
  if (!pathname) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== segment) return null;
  const value = String(parts[1] || '').trim();
  return /^\d+$/.test(value) ? value : null;
}

function TechStationContext({ techId }: { techId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const staffDirectory = useActiveStaffDirectory();

  const techName = staffDirectory.find((member) => String(member.id) === String(techId))?.name || 'Technician';
  const techTheme = getTechThemeById(techId);
  const rawView = searchParams.get('view');
  const viewMode = rawView === 'pending' ? 'pending' : rawView === 'manual' ? 'manual' : rawView === 'update-manuals' ? 'update-manuals' : 'history';

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/tech-logs?techId=${techId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          setHistory(data);
        }
      } catch (_error) {
        // no-op
      }
    };

    getStaffGoalById(techId).then(setDailyGoal).catch(() => {});

    fetchHistory();
  }, [techId]);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const todayDate = getCurrentPSTDateKey();
    return history.filter((item) => toPSTDateKey(item.test_date_time || item.timestamp || '') === todayDate).length;
  }, [history]);

  const updateViewMode = (nextView: 'history' | 'pending' | 'manual' | 'update-manuals') => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    if (nextView === 'history') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextView);
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  const refreshHistory = async () => {
    try {
      const res = await fetch(`/api/tech-logs?techId=${techId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setHistory(data);
      }
    } catch (_error) {
      // no-op
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="border-b border-gray-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="min-w-0">
            <StaffSelector
              role="technician"
              variant="boxy"
              selectedStaffId={parseInt(techId, 10)}
              onSelect={(id) => router.push(`/tech?staffId=${id}`)}
            />
          </div>
          <div className="relative min-w-0">
            <ViewDropdown
              options={[
                { value: 'history', label: 'Tech History' },
                { value: 'pending', label: 'Pending Orders' },
                { value: 'manual', label: 'Last Order Manual' },
                { value: 'update-manuals', label: 'Update Manuals' },
              ]}
              value={viewMode}
              onChange={(nextView) => updateViewMode(nextView as 'history' | 'pending' | 'manual' | 'update-manuals')}
              variant="boxy"
              buttonClassName="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none text-left"
              optionClassName="text-[10px] font-black tracking-wider"
            />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <StationTesting
          embedded
          userId={techId}
          userName={techName}
          themeColor={techTheme}
          onTrackingScan={() => updateViewMode('history')}
          onViewManual={() => updateViewMode('manual')}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
    </div>
  );
}

type ReceivingMode = 'bulk' | 'unboxing' | 'pickup';

interface ZohoPORow {
  purchaseorder_id: string;
  purchaseorder_number?: string;
  reference_number?: string;
  vendor_name?: string;
  status?: string;
  date?: string;
  delivery_date?: string;
  total?: number;
  currency_code?: string;
}

function statusPill(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'issued':    return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'partially_received': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'received':  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'open':      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'billed':    return 'bg-green-50 text-green-700 border-green-200';
    case 'draft':     return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'cancelled': return 'bg-red-50 text-red-600 border-red-200';
    default:          return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function formatMoney(value?: number, currencyCode?: string): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode || 'USD',
    maximumFractionDigits: 2,
  }).format(value as number);
}

function ReceivingContext() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode =
    rawMode === 'unboxing' ? 'unboxing' : rawMode === 'pickup' ? 'pickup' : 'bulk';

  const staffId = searchParams.get('staffId') || '7';

  // ── PO search state ──────────────────────────────────────────────────────────
  const [poSearch, setPoSearch] = useState('');
  const [poList, setPoList] = useState<ZohoPORow[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [bulkTracking, setBulkTracking] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPOs = useCallback(async (q: string) => {
    setPoLoading(true);
    try {
      const params = new URLSearchParams({ per_page: '60' });
      if (q.trim()) params.set('search_text', q.trim());
      const res = await fetch(`/api/zoho/purchase-orders?${params}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const rows = Array.isArray(json.purchaseorders) ? json.purchaseorders : [];
      const activeStatuses = new Set(['issued', 'partially_received', 'open']);
      setPoList(
        rows.filter((row: ZohoPORow) => {
          const status = String(row?.status || '').toLowerCase();
          if (!q.trim()) return activeStatuses.has(status);
          return true;
        })
      );
    } catch {
      // no-op
    } finally {
      setPoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPOs(poSearch), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [poSearch, fetchPOs]);

  const submitBulkScan = useCallback(async () => {
    const trackingNumber = bulkTracking.trim();
    if (!trackingNumber || bulkSubmitting) return;

    setBulkSubmitting(true);
    try {
      const res = await fetch('/api/receiving-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber,
          qaStatus: 'PENDING',
          dispositionCode: 'HOLD',
          conditionGrade: 'BRAND_NEW',
          isReturn: false,
        }),
      });
      if (!res.ok) throw new Error('Failed to add receiving entry');
      const data = await res.json();

      setBulkTracking('');
      invalidateReceivingCache();
      if (data?.record) {
        window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      if (data?.record?.id) {
        window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
      }
    } catch (_error) {
      window.alert('Failed to add receiving entry.');
    } finally {
      setBulkSubmitting(false);
    }
  }, [bulkTracking, bulkSubmitting]);

  // ── Unboxing queue history ────────────────────────────────────────────────────
  const [history, setHistory] = useState<LogRow[]>([]);

  useEffect(() => {
    if (mode !== 'unboxing') return;
    const load = async () => {
      try {
        const data = await getReceivingLogs(500);
        setHistory(data);
      } catch { /* no-op */ }
    };
    load();

    const onRefresh = () => { invalidateReceivingCache(); load(); };
    const onEntry = (e: Event) => {
      const { detail } = e as CustomEvent;
      if (!detail) return;
      setHistory((prev) => [{
        id: detail.id,
        timestamp: detail.timestamp,
        tracking: detail.receiving_tracking_number || detail.tracking,
        carrier: detail.carrier,
        qa_status: detail.qa_status || 'PENDING',
      }, ...prev]);
    };
    window.addEventListener('usav-refresh-data', onRefresh);
    window.addEventListener('receiving-entry-added', onEntry);
    return () => {
      window.removeEventListener('usav-refresh-data', onRefresh);
      window.removeEventListener('receiving-entry-added', onEntry);
    };
  }, [mode]);

  const updateMode = (nextMode: ReceivingMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Staff + mode selector */}
      <div className="border-b border-gray-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="min-w-0">
            <StaffSelector
              role="all"
              variant="boxy"
              selectedStaffId={parseInt(staffId, 10)}
              onSelect={updateStaff}
            />
          </div>
          <div className="relative min-w-0">
            <ViewDropdown
              options={[
                { value: 'bulk', label: 'Bulk Scan' },
                { value: 'unboxing', label: 'Unboxing' },
                { value: 'pickup', label: 'Local Pickup' },
              ]}
              value={mode}
              onChange={(nextMode) => updateMode(nextMode as ReceivingMode)}
              variant="boxy"
              buttonClassName="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none text-left"
              optionClassName="text-[10px] font-black tracking-wider"
            />
          </div>
        </div>
      </div>

      {/* PO search bar — always visible */}
      <div className="border-b border-gray-200 bg-white px-3 py-2">
        {mode === 'bulk' ? (
          <SearchBar
            value={bulkTracking}
            onChange={setBulkTracking}
            onSearch={submitBulkScan}
            onClear={() => setBulkTracking('')}
            placeholder="Scan or enter tracking…"
            variant="blue"
            isSearching={bulkSubmitting}
          />
        ) : (
          <SearchBar
            value={poSearch}
            onChange={setPoSearch}
            onClear={() => setPoSearch('')}
            placeholder="Search purchase orders…"
            variant="emerald"
            isSearching={poLoading}
            rightElement={
              <button
                type="button"
                onClick={() => fetchPOs(poSearch)}
                disabled={poLoading}
                className="flex-shrink-0 p-2 rounded-xl border border-gray-200 bg-white text-gray-400 hover:text-emerald-600 hover:border-emerald-300 transition-colors disabled:opacity-40"
                title="Refresh POs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${poLoading ? 'animate-spin' : ''}`} />
              </button>
            }
          />
        )}
      </div>

      {/* Unboxing queue (only in unboxing mode) */}
      {mode === 'unboxing' && (
        <div className="flex-1 overflow-hidden border-b border-gray-100">
          <UnboxingQueuePanel history={history} />
        </div>
      )}

      {/* PO list */}
      <div className={`${mode === 'unboxing' ? 'h-0 overflow-hidden' : 'flex-1 overflow-y-auto'}`}>
        {poLoading && poList.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
          </div>
        ) : poList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 opacity-30">
            <Package className="w-8 h-8" />
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              {poSearch.trim() ? 'No matching POs' : 'No open POs'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {poList.map((po) => (
              <button
                key={po.purchaseorder_id}
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('receiving-open-po', { detail: po }))}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-gray-800 uppercase tracking-wide truncate">
                    {po.purchaseorder_number || po.reference_number || po.purchaseorder_id}
                  </span>
                  <span className={`flex-shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusPill(po.status)}`}>
                    {po.status || '—'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-gray-400 truncate">
                    {po.vendor_name || 'Unknown vendor'}
                    {po.date ? ` · ${po.date}` : ''}
                  </p>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                    {formatMoney(po.total, po.currency_code) || '—'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PackerStationContext({ packerId }: { packerId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const staffDirectory = useActiveStaffDirectory();
  const packerName = staffDirectory.find((member) => String(member.id) === String(packerId))?.name || 'Packer';
  const packerTheme = getPackerThemeById(packerId);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          setHistory(data);
        }
      } catch (_error) {
        // no-op
      }
    };

    getStaffGoalById(packerId).then(setDailyGoal).catch(() => {});

    fetchHistory();
  }, [packerId]);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const todayDate = getCurrentPSTDateKey();
    return history.filter((item) => toPSTDateKey(item.pack_date_time || item.timestamp || item.packedAt || '') === todayDate).length;
  }, [history]);

  const refreshHistory = async () => {
    try {
      const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setHistory(data);
      }
    } catch (_error) {
      // no-op
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="border-b border-gray-200 bg-white">
        <div className="grid grid-cols-1">
          <StaffSelector
            role="all"
            variant="boxy"
            selectedStaffId={parseInt(packerId, 10)}
            onSelect={(id) => router.push(`/packer?staffId=${id}`)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <StationPacking
          embedded
          userId={packerId}
          userName={packerName}
          themeColor={packerTheme}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
    </div>
  );
}

function FbaContextPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStatus = (searchParams.get('status')?.toUpperCase() || 'ALL') as FbaStatus;
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');

  const updateFbaParams = (patch: { status?: FbaStatus; q?: string; r?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (patch.status !== undefined) {
      if (patch.status === 'ALL') params.delete('status');
      else params.set('status', patch.status);
    }
    if (patch.q !== undefined) {
      if (patch.q.trim()) params.set('q', patch.q.trim());
      else params.delete('q');
    }
    if (patch.r !== undefined) params.set('r', patch.r);
    router.replace(`/fba?${params.toString()}`);
  };

  // Debounce search query to URL
  useEffect(() => {
    const t = setTimeout(() => updateFbaParams({ q: localSearch }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  // Sync if URL q changes externally (e.g. clear from board)
  const urlQ = searchParams.get('q') || '';
  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Status ViewDropdown — boxy, edge-to-edge */}
      <div className="border-b border-gray-200 bg-white">
        <ViewDropdown
          options={FBA_STATUS_OPTIONS}
          value={activeStatus}
          onChange={(status) => updateFbaParams({ status })}
          variant="boxy"
          buttonClassName="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none text-left"
          optionClassName="text-[10px] font-black tracking-wider"
        />
      </div>

      {/* Search bar */}
      <div className="border-b border-gray-200 bg-white px-3 py-2">
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search FNSKU, product, ASIN, SKU..."
          variant="purple"
        />
      </div>

      {/* Stats + new-shipment form */}
      <div className="flex-1 overflow-y-auto">
        <FbaSidebar onShipmentCreated={() => updateFbaParams({ r: String(Date.now()) })} />
      </div>
    </div>
  );
}

function SidebarContextPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeKey = getSidebarRouteKey(pathname);

  const updateSearch = (mutate: (params: URLSearchParams) => void, nextPathname?: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const targetPath = nextPathname || pathname || '/dashboard';
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath);
  };

  const closeIntakeForm = () => {
    updateSearch((params) => {
      params.delete('new');
    });
  };

  const submitShippedForm = async (data: ShippedFormData) => {
    try {
      const response =
        data.mode === 'add_order'
          ? await fetch('/api/orders/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: data.order_id,
                productTitle: data.product_title,
                shippingTrackingNumber: data.shipping_tracking_number,
                sku: data.sku || null,
                accountSource: 'Manual',
                condition: data.condition,
              }),
            })
          : await fetch('/api/shipped/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });

      const result = await response.json();
      if (!result.success) {
        alert(result.error || 'Failed to submit form. Please try again.');
        return;
      }

      closeIntakeForm();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (_error) {
      alert('Error submitting form. Please try again.');
    }
  };

  if (routeKey === 'dashboard') {
    const orderView = getOrderViewFromSearch(searchParams);
    const filterControl = (
      <ViewDropdown
        options={ORDER_VIEW_OPTIONS}
        value={orderView}
        onChange={(nextView) =>
          updateSearch((params) => {
            normalizeOrderViewParams(params, nextView);
            if (nextView !== 'shipped') {
              params.delete('search');
            }
          }, '/dashboard')
        }
      />
    );

    if (orderView === 'shipped') {
      return (
        <ShippedSidebar
          embedded
          hideSectionHeader
          showIntakeForm={searchParams.get('new') === 'true'}
          onCloseForm={closeIntakeForm}
          onFormSubmit={submitShippedForm}
          filterControl={filterControl}
          showDetailsPanel={false}
        />
      );
    }

    if (orderView === 'unshipped') {
      return (
        <UnshippedSidebar
          embedded
          hideSectionHeader
          showIntakeForm={searchParams.get('new') === 'true'}
          onCloseForm={closeIntakeForm}
          onFormSubmit={submitShippedForm}
          filterControl={filterControl}
        />
      );
    }

    return (
      <DashboardManagementPanel
        showIntakeForm={searchParams.get('new') === 'true'}
        onCloseForm={closeIntakeForm}
        onFormSubmit={submitShippedForm}
        filterControl={filterControl}
        showNextUnassignedButton={orderView === 'pending'}
      />
    );
  }

  if (routeKey === 'admin') {
    const activeSection = (searchParams.get('section') as AdminSection) || 'goals';
    const validSection = ADMIN_SECTION_OPTIONS.some((item) => item.value === activeSection) ? activeSection : 'goals';
    const sidebarSearch = searchParams.get('search') || '';

    return (
      <div className="h-full overflow-hidden">
        <AdminSidebar
          activeSection={validSection}
          onSectionChange={(nextSection) =>
            updateSearch((params) => {
              params.set('section', nextSection);
            }, '/admin')
          }
          searchValue={sidebarSearch}
          onSearchChange={(nextValue) =>
            updateSearch((params) => {
              if (nextValue.trim()) {
                params.set('search', nextValue);
              } else {
                params.delete('search');
              }
            }, '/admin')
          }
        />
      </div>
    );
  }

  if (routeKey === 'support') {
    return (
      <div className="h-full overflow-y-auto px-4 py-4">
        <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-600">Customer Support</p>
          <h3 className="mt-2 text-lg font-black tracking-tight text-gray-900">Operational queue</h3>
          <p className="mt-2 text-[11px] font-medium leading-relaxed text-gray-600">
            This page centralizes eBay unread conversations, eBay return requests, and Zendesk open tickets so support work
            is triaged from one queue.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('support-refresh'))}
            className="mt-4 inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-black"
          >
            Refresh Queue
          </button>
          <div className="mt-4 space-y-2 text-[10px] font-bold uppercase tracking-[0.18em]">
            <Link href="/admin?section=connections" className="block rounded-2xl border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900">
              Check Connections
            </Link>
            <Link href="/repair" className="block rounded-2xl border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900">
              Repair Tickets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (routeKey === 'receiving') {
    return <ReceivingContext />;
  }

  if (routeKey === 'fba') {
    return <FbaContextPanel />;
  }

  if (routeKey === 'sku-stock') {
    return <BarcodeSidebar embedded />;
  }

  if (routeKey === 'repair') {
    return <RepairSidebar embedded hideSectionHeader />;
  }

  if (routeKey === 'previous-quarters') {
    return <QuarterSidebar hideSectionHeader />;
  }

  if (routeKey === 'tech') {
    const techId = searchParams.get('staffId') || getPathStaffId(pathname, 'tech') || '1';
    return <TechStationContext techId={techId} />;
  }

  if (routeKey === 'packer') {
    const packerId = searchParams.get('staffId') || getPathStaffId(pathname, 'packer') || '4';
    return <PackerStationContext packerId={packerId} />;
  }

  if (routeKey === 'manuals') {
    return <ManualsSidebar />;
  }

  return (
    <div className="h-full flex flex-col px-6 py-6">
      <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[18px] font-black uppercase tracking-tight">Workspace</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-blue-200">Unified Sidebar</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] font-medium leading-relaxed text-slate-200">
          Navigation and contextual controls now live in one persistent sidebar. Pick a route to load its tools here.
        </p>
      </div>
    </div>
  );
}

function getSidebarTitle(pathname: string | null) {
  const routeKey = getSidebarRouteKey(pathname);

  if (routeKey === 'dashboard') {
    return 'Dashboard';
  }

  if (routeKey === 'fba') return 'FBA';
  if (routeKey === 'receiving') return 'Receiving';
  if (routeKey === 'repair') return 'Repair';
  if (routeKey === 'sku-stock') return 'Sku Stock';
  if (routeKey === 'tech') return 'Technicians';
  if (routeKey === 'packer') return 'Packers';
  if (routeKey === 'support') return 'Support';
  if (routeKey === 'previous-quarters') return 'Quarters';
  if (routeKey === 'admin') return 'Admin';
  if (routeKey === 'manuals') return 'Manuals';

  return 'Home';
}

function NavSection({
  items,
  pathname,
  resolveHref,
  onNavigate,
}: {
  items: SidebarNavItem[];
  pathname: string | null;
  resolveHref: (item: SidebarNavItem) => string;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const href = resolveHref(item);
        const isActive = isSidebarNavActive(pathname, href);
        const Icon = item.icon;

        return (
          <Link
            key={item.id}
            href={href}
            onClick={onNavigate}
            className={`group flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 ${
              isActive
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-blue-500'}`} />
            <span className="text-[11px] font-black uppercase tracking-wider">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [showHomeNavigation, setShowHomeNavigation] = useState(false);
  const [lastTechHref, setLastTechHref] = useState('/tech?staffId=1');
  const [lastPackerHref, setLastPackerHref] = useState('/packer?staffId=4');

  useEffect(() => {
    const savedTechHref = localStorage.getItem('last-tech-station-href');
    if (savedTechHref) {
      const legacyId = savedTechHref.match(/^\/tech\/(\d+)$/)?.[1];
      if (legacyId) {
        setLastTechHref(`/tech?staffId=${legacyId}`);
      } else if (/^\/tech(\?.*)?$/.test(savedTechHref)) {
        setLastTechHref(savedTechHref);
      }
    }

    const savedPackerHref = localStorage.getItem('last-packer-station-href');
    if (savedPackerHref) {
      const legacyId = savedPackerHref.match(/^\/packer\/(\d+)$/)?.[1];
      if (legacyId) {
        setLastPackerHref(`/packer?staffId=${legacyId}`);
      } else if (/^\/packer(\?.*)?$/.test(savedPackerHref)) {
        setLastPackerHref(savedPackerHref);
      }
    }
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith('/tech')) {
      const params = new URLSearchParams(searchParams.toString());
      const pathId = getPathStaffId(pathname, 'tech');
      if (!params.get('staffId') && pathId) params.set('staffId', pathId);
      if (!params.get('staffId')) params.set('staffId', '1');
      const href = `/tech?${params.toString()}`;
      localStorage.setItem('last-tech-station-href', href);
      setLastTechHref(href);
    }
    if (pathname.startsWith('/packer')) {
      const params = new URLSearchParams(searchParams.toString());
      const pathId = getPathStaffId(pathname, 'packer');
      if (!params.get('staffId') && pathId) params.set('staffId', pathId);
      if (!params.get('staffId')) params.set('staffId', '4');
      const href = `/packer?${params.toString()}`;
      localStorage.setItem('last-packer-station-href', href);
      setLastPackerHref(href);
    }
    setShowHomeNavigation(false);
    setIsMobileOpen(false);
    setIsDetailsPanelOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleOpenDetails = () => {
      setIsDetailsPanelOpen(true);
      setIsMobileOpen(false);
    };
    const handleCloseDetails = () => {
      setIsDetailsPanelOpen(false);
    };

    window.addEventListener('open-shipped-details' as any, handleOpenDetails as any);
    window.addEventListener('close-shipped-details' as any, handleCloseDetails as any);

    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpenDetails as any);
      window.removeEventListener('close-shipped-details' as any, handleCloseDetails as any);
    };
  }, []);

  const resolveHref = (item: SidebarNavItem) => {
    if (item.id === 'tech') return lastTechHref;
    if (item.id === 'packer') return lastPackerHref;
    return item.href;
  };
  const routeKey = getSidebarRouteKey(pathname);
  const sidebarTitle = getSidebarTitle(pathname);

  const groupedNav = {
    main: APP_SIDEBAR_NAV.filter((item) => item.kind === 'main'),
    station: APP_SIDEBAR_NAV.filter((item) => item.kind === 'station'),
    bottom: APP_SIDEBAR_NAV.filter((item) => item.kind === 'bottom'),
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
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
    },
  };

  const homePanel = (
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full overflow-y-auto bg-white">
      <div className="px-3 py-3 space-y-6">
        <motion.div variants={itemVariants}>
          <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-blue-600">Main</p>
          <NavSection items={groupedNav.main} pathname={pathname} resolveHref={resolveHref} onNavigate={() => setShowHomeNavigation(false)} />
        </motion.div>

        <motion.div variants={itemVariants}>
          <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Stations</p>
          <NavSection items={groupedNav.station} pathname={pathname} resolveHref={resolveHref} onNavigate={() => setShowHomeNavigation(false)} />
        </motion.div>

        <motion.div variants={itemVariants}>
          <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">More</p>
          <NavSection items={groupedNav.bottom} pathname={pathname} resolveHref={resolveHref} onNavigate={() => setShowHomeNavigation(false)} />
        </motion.div>
      </div>
    </motion.div>
  );

  const contextPanel = (
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden bg-white">
      <motion.button
        variants={itemVariants}
        type="button"
        onClick={() => setShowHomeNavigation(true)}
        className="w-full flex items-center gap-2 pl-1.5 pr-3 pt-1 pb-1 border-b border-gray-100 text-left hover:bg-gray-50 transition-colors"
        aria-label="Back to navigation"
      >
        <div className="h-9 w-7 flex items-center justify-start text-gray-500">
          <ChevronLeft className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black tracking-tight text-gray-900 truncate">{sidebarTitle}</p>
        </div>
      </motion.button>
      <motion.div variants={itemVariants} className="flex-1 overflow-hidden">
        <SidebarContextPanel />
      </motion.div>
    </motion.div>
  );

  const shell = (
    <aside className="h-full w-full bg-white border-r border-gray-200 overflow-hidden shadow-xl shadow-slate-900/5">
      {showHomeNavigation || routeKey === 'unknown' ? homePanel : contextPanel}
    </aside>
  );

  return (
    <>
      <div
        className={`hidden md:block h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 ${
          isDetailsPanelOpen ? 'w-0' : 'w-[360px]'
        }`}
      >
        {shell}
      </div>

      {isDetailsPanelOpen ? (
        <button
          type="button"
          onClick={() => {
            dispatchCloseShippedDetails();
            setIsDetailsPanelOpen(false);
          }}
          className="hidden md:flex fixed top-4 left-4 z-[90] h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-slate-900/10 items-center justify-center"
          aria-label="Open station navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-[90] h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-slate-900/10 flex items-center justify-center"
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5" />
      </button>

      {isMobileOpen ? (
        <div className="md:hidden fixed inset-0 z-[100]">
          <button type="button" className="absolute inset-0 bg-slate-900/35" onClick={() => setIsMobileOpen(false)} aria-label="Close sidebar overlay" />
          <div className="relative h-full max-w-[94vw]">{shell}</div>
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="absolute top-4 right-4 h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-slate-900/10 flex items-center justify-center"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      ) : null}
    </>
  );
}
