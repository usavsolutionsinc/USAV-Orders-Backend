'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  X,
} from '@/components/Icons';
import { AdminSidebar, ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/AdminSidebar';
import BarcodeSidebar from '@/components/BarcodeSidebar';
import { QuarterSidebar } from '@/components/QuarterSelector';
import { DashboardManagementPanel } from '@/components/sidebar/DashboardManagementPanel';
import { RepairSidebar } from '@/components/repair';
import ShippedSidebar from '@/components/ShippedSidebar';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import ReceivingSidebar from '@/components/ReceivingSidebar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StationTesting from '@/components/station/StationTesting';
import StationPacking from '@/components/station/StationPacking';
import StaffSelector from '@/components/StaffSelector';
import {
  APP_SIDEBAR_NAV,
  getSidebarRouteKey,
  isSidebarNavActive,
  type SidebarNavItem,
} from '@/lib/sidebar-navigation';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { getPackerThemeById, getTechThemeById } from '@/utils/staff-colors';
import type { ShippedFormData } from '@/components/shipped';

type DashboardOrderView = 'pending' | 'unshipped' | 'shipped';

const ORDER_VIEW_OPTIONS: Array<{ value: DashboardOrderView; label: string }> = [
  { value: 'unshipped', label: 'Unshipped Orders' },
  { value: 'pending', label: 'Pending Orders' },
  { value: 'shipped', label: 'Shipped Orders' },
];

const TECH_NAMES: Record<string, string> = {
  '1': 'Michael',
  '2': 'Thuc',
  '3': 'Sang',
  '4': 'Cuong',
  '6': 'Cuong',
};

const PACKER_NAMES: Record<string, string> = {
  '4': 'Tuan',
  '5': 'Thuy',
  '6': 'Packer',
};

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

function getTechName(id: string) {
  return TECH_NAMES[id] || 'Technician';
}

function getPackerName(id: string) {
  return PACKER_NAMES[id] || 'Packer';
}

function TechStationContext({ techId }: { techId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);

  const techName = getTechName(techId);
  const techTheme = getTechThemeById(techId);
  const viewMode = searchParams.get('view') === 'pending' ? 'pending' : 'history';

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

    const fetchGoal = async () => {
      try {
        const res = await fetch(`/api/staff-goals?staffId=${encodeURIComponent(techId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const goalValue = Number(data?.daily_goal);
        if (Number.isFinite(goalValue) && goalValue > 0) {
          setDailyGoal(goalValue);
        }
      } catch (_error) {
        // no-op
      }
    };

    fetchHistory();
    fetchGoal();
  }, [techId]);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const todayDate = getCurrentPSTDateKey();
    return history.filter((item) => toPSTDateKey(item.test_date_time || item.timestamp || '') === todayDate).length;
  }, [history]);

  const updateViewMode = (nextView: 'history' | 'pending') => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextView === 'history') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', 'pending');
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech/${techId}?${nextSearch}` : `/tech/${techId}`);
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
              onSelect={(id) => router.push(`/tech/${id}`)}
            />
          </div>
          <div className="relative min-w-0">
            <select
              value={viewMode}
              onChange={(e) => updateViewMode(e.target.value as 'history' | 'pending')}
              className="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none"
            >
              <option value="history">Tech History</option>
              <option value="pending">Pending Orders</option>
            </select>
            <svg
              className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <StationTesting
          embedded
          userId={techId}
          userName={techName}
          sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
          themeColor={techTheme}
          onTrackingScan={() => updateViewMode('history')}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
    </div>
  );
}

function PackerStationContext({ packerId }: { packerId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const packerName = getPackerName(packerId);
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

    const fetchGoal = async () => {
      try {
        const res = await fetch(`/api/staff-goals?staffId=${encodeURIComponent(packerId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const goalValue = Number(data?.daily_goal);
        if (Number.isFinite(goalValue) && goalValue > 0) {
          setDailyGoal(goalValue);
        }
      } catch (_error) {
        // no-op
      }
    };

    fetchHistory();
    fetchGoal();
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
            role="packer"
            variant="boxy"
            selectedStaffId={parseInt(packerId, 10)}
            onSelect={(id) => router.push(`/packer/${id}`)}
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
      />
    );
  }

  if (routeKey === 'shipped') {
    return (
      <ShippedSidebar
        embedded
        hideSectionHeader
        showIntakeForm={searchParams.get('new') === 'true'}
        onCloseForm={closeIntakeForm}
        onFormSubmit={submitShippedForm}
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

  if (routeKey === 'receiving') {
    return <ReceivingSidebar embedded hideSectionHeader />;
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
    const techId = pathname?.split('/').filter(Boolean)[1] || '1';
    return <TechStationContext techId={techId} />;
  }

  if (routeKey === 'packer') {
    const packerId = pathname?.split('/').filter(Boolean)[1] || '4';
    return <PackerStationContext packerId={packerId} />;
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

  if (routeKey === 'shipped') return 'Shipped Orders';
  if (routeKey === 'receiving') return 'Receiving';
  if (routeKey === 'repair') return 'Repair';
  if (routeKey === 'sku-stock') return 'Sku Stock';
  if (routeKey === 'tech') return 'Technicians';
  if (routeKey === 'packer') return 'Packers';
  if (routeKey === 'sku') return 'Sku Manager';
  if (routeKey === 'previous-quarters') return 'Quarters';
  if (routeKey === 'admin') return 'Admin';

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
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [showHomeNavigation, setShowHomeNavigation] = useState(false);
  const [lastTechHref, setLastTechHref] = useState('/tech/1');
  const [lastPackerHref, setLastPackerHref] = useState('/packer/4');

  useEffect(() => {
    const savedTechHref = localStorage.getItem('last-tech-station-href');
    if (savedTechHref && /^\/tech\/\d+$/.test(savedTechHref)) {
      setLastTechHref(savedTechHref);
    }

    const savedPackerHref = localStorage.getItem('last-packer-station-href');
    if (savedPackerHref && /^\/packer\/\d+$/.test(savedPackerHref)) {
      setLastPackerHref(savedPackerHref);
    }
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (/^\/tech\/\d+$/.test(pathname)) {
      localStorage.setItem('last-tech-station-href', pathname);
      setLastTechHref(pathname);
    }
    if (/^\/packer\/\d+$/.test(pathname)) {
      localStorage.setItem('last-packer-station-href', pathname);
      setLastPackerHref(pathname);
    }
    setShowHomeNavigation(false);
    setIsMobileOpen(false);
  }, [pathname]);

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
      <motion.div variants={itemVariants} className="flex items-center justify-between px-4 pt-1 pb-1.5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm font-black tracking-tight text-gray-900">Home</p>
          </div>
        </div>
      </motion.div>

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
    <aside className="h-full w-[320px] xl:w-[360px] bg-white border-r border-gray-200 overflow-hidden shadow-xl shadow-slate-900/5">
      {showHomeNavigation || routeKey === 'unknown' ? homePanel : contextPanel}
    </aside>
  );

  return (
    <>
      <div className="hidden md:block h-full flex-shrink-0">{shell}</div>

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
