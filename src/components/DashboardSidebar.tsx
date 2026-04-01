'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Menu, X, Zap } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/admin-sections';
import BarcodeSidebar from '@/components/BarcodeSidebar';
import { QuarterSidebar } from '@/components/QuarterSelector';
import { DashboardManagementPanel } from '@/components/sidebar/DashboardManagementPanel';
import { RepairSidebarPanel } from '@/components/sidebar/RepairSidebarPanel';
import ShippedSidebar from '@/components/ShippedSidebar';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import { ManualsSidebar } from '@/components/manuals/ManualsSidebar';
import { SidebarTabSwitchChrome, TabSwitch } from '@/components/ui/TabSwitch';
import { TechSidebarPanel } from '@/components/sidebar/TechSidebarPanel';
import { PackerSidebarPanel } from '@/components/sidebar/PackerSidebarPanel';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { FbaSidebarPanel } from '@/components/fba/sidebar';
import { SupportSidebarPanel } from '@/components/sidebar/SupportSidebarPanel';
import { WorkOrdersSidebarPanel } from '@/components/sidebar/WorkOrdersSidebarPanel';
import { OperationsSidebarPanel } from '@/components/sidebar/OperationsSidebarPanel';
import {
  APP_SIDEBAR_NAV,
  getSidebarRouteKey,
  isSidebarNavActive,
  type SidebarNavItem,
} from '@/lib/sidebar-navigation';
import type { ShippedFormData } from '@/components/shipped';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { parseDashboardOpenOrderId } from '@/utils/dashboard-search-state';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
import { DeviceModeToggle } from '@/components/sidebar/DeviceModeToggle';

const MOBILE_SIDEBAR_MIN_WIDTH = 420;

const DASHBOARD_TABS = [
  { id: 'pending',   label: 'Pending',  color: 'blue' as const },
  { id: 'shipped',   label: 'Shipped',  color: 'blue' as const },
  { id: 'unshipped', label: 'Awaiting', color: 'blue' as const },
];

function getPathStaffId(pathname: string | null, segment: 'tech' | 'packer'): string | null {
  if (!pathname) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== segment) return null;
  const value = String(parts[1] || '').trim();
  return /^\d+$/.test(value) ? value : null;
}

function getSidebarTitle(pathname: string | null) {
  const routeKey = getSidebarRouteKey(pathname);
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    operations: 'Operations',
    fba: 'FBA',
    receiving: 'Receiving',
    repair: 'Repair',
    'work-orders': 'Work Orders',
    'sku-stock': 'Sku Stock',
    tech: 'Technicians',
    packer: 'Packers',
    support: 'Support',
    'previous-quarters': 'Quarters',
    admin: 'Admin',
    manuals: 'Manuals',
    ai: 'AI Chat',
  };
  return titles[routeKey] ?? 'Home';
}

// ---------------------------------------------------------------------------
// AI Chat sidebar panel
// ---------------------------------------------------------------------------
function AiSidebarPanel() {
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/tunnel-health');
      const data = await res.json();
      setConnectionOk(!!data.ok);
      setTunnelUrl(data.tunnel_url ?? null);
    } catch {
      setConnectionOk(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 30_000);
    return () => clearInterval(id);
  }, [checkHealth]);

  const handleNewChat = () => {
    window.dispatchEvent(new CustomEvent('ai-new-chat'));
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
      {/* Connection status card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className={`${sectionLabel} text-gray-900`}>AI Assistant</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-gray-500">Ollama via Tunnel</p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
          {connectionOk === null && (
            <span className="inline-block h-2 w-2 rounded-full bg-gray-300 animate-pulse" />
          )}
          {connectionOk === true && (
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
          {connectionOk === false && (
            <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
          )}
          <span className={`text-[9px] font-black uppercase tracking-[0.25em] ${
            connectionOk === true ? 'text-emerald-600' :
            connectionOk === false ? 'text-red-500' : 'text-gray-500'
          }`}>
            {connectionOk === null ? 'Checking…' :
             connectionOk ? 'Backend online' : 'Backend offline'}
          </span>
        </div>

        {tunnelUrl && (
          <p className="mt-2 text-[9px] font-semibold text-gray-500 truncate" title={tunnelUrl}>
            {tunnelUrl}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleNewChat}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 ${sectionLabel} text-white transition-colors hover:bg-black`}
        >
          New Chat
        </button>
        <button
          type="button"
          onClick={checkHealth}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl border border-gray-200 px-4 py-2 ${sectionLabel} text-gray-600 transition-colors hover:bg-gray-50`}
        >
          Refresh Status
        </button>
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-1.5">How it works</p>
        <p className="text-[10px] font-semibold leading-relaxed text-gray-500">
          Messages are proxied through this server to the home computer running
          Ollama over a Cloudflare tunnel. The tunnel URL is read from the database.
        </p>
      </div>
    </div>
  );
}

function SidebarContextPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeKey = getSidebarRouteKey(pathname);
  const dashboardSearch = useDashboardSearchController();

  const updateSearch = (mutate: (params: URLSearchParams) => void, nextPathname?: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const targetPath = nextPathname || pathname || '/dashboard';
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath);
  };

  const closeIntakeForm = routeKey === 'dashboard'
    ? dashboardSearch.closeIntakeForm
    : () => updateSearch((params) => { params.delete('new'); });

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
    } catch {
      alert('Error submitting form. Please try again.');
    }
  };

  if (routeKey === 'dashboard') {
    const activeTabId: string = dashboardSearch.orderView;
    const filterControl = (
      <SidebarTabSwitchChrome>
        <TabSwitch
          tabs={DASHBOARD_TABS}
          activeTab={activeTabId}
          highContrast
          onTabChange={(tab) => dashboardSearch.setOrderView(tab as typeof dashboardSearch.orderView)}
        />
      </SidebarTabSwitchChrome>
    );

    if (dashboardSearch.orderView === 'shipped') {
      return (
        <ShippedSidebar
          embedded
          hideSectionHeader
          showIntakeForm={dashboardSearch.showIntakeForm}
          onCloseForm={closeIntakeForm}
          onFormSubmit={submitShippedForm}
          filterControl={filterControl}
          showDetailsPanel={false}
          searchValue={dashboardSearch.searchQuery}
          onSearchChange={dashboardSearch.setSearch}
          shippedFilter={dashboardSearch.shippedFilter}
          onShippedFilterChange={dashboardSearch.setShippedFilter}
        />
      );
    }

    if (dashboardSearch.orderView === 'unshipped') {
      return (
        <UnshippedSidebar
          embedded
          hideSectionHeader
          showIntakeForm={dashboardSearch.showIntakeForm}
          onCloseForm={closeIntakeForm}
          onFormSubmit={submitShippedForm}
          filterControl={filterControl}
          searchValue={dashboardSearch.searchQuery}
          onSearchChange={dashboardSearch.setSearch}
          onOpenShippedMatches={dashboardSearch.openShippedMatches}
        />
      );
    }

    return (
      <DashboardManagementPanel
        showIntakeForm={dashboardSearch.showIntakeForm}
        onCloseForm={closeIntakeForm}
        onFormSubmit={submitShippedForm}
        filterControl={filterControl}
        showNextUnassignedButton={dashboardSearch.orderView === 'pending'}
        searchValue={dashboardSearch.searchQuery}
        onSearchChange={dashboardSearch.setSearch}
        onOpenShippedMatches={dashboardSearch.openShippedMatches}
        showPendingFilterControl={dashboardSearch.orderView === 'pending'}
        pendingFilterValue={dashboardSearch.pendingFilter}
        highContrastSliders
        onPendingFilterChange={dashboardSearch.setPendingFilter}
      />
    );
  }

  if (routeKey === 'operations') {
    return <OperationsSidebarPanel />;
  }

  if (routeKey === 'admin') {
    const activeSection = (searchParams.get('section') as AdminSection) || 'goals';
    const validSection = ADMIN_SECTION_OPTIONS.some((item) => item.value === activeSection) ? activeSection : 'goals';

    return (
      <div className="h-full overflow-hidden">
        <AdminSidebar
          activeSection={validSection}
          onSectionChange={(nextSection) =>
            updateSearch((params) => { params.set('section', nextSection); }, '/admin')
          }
        />
      </div>
    );
  }

  if (routeKey === 'ai') return <AiSidebarPanel />;
  if (routeKey === 'support') return <SupportSidebarPanel />;
  if (routeKey === 'receiving') return <ReceivingSidebarPanel />;
  if (routeKey === 'fba') return <FbaSidebarPanel />;
  if (routeKey === 'work-orders') return <WorkOrdersSidebarPanel />;
  if (routeKey === 'sku-stock') return <BarcodeSidebar embedded />;
  if (routeKey === 'repair') return <RepairSidebarPanel embedded hideSectionHeader />;
  if (routeKey === 'previous-quarters') return <QuarterSidebar hideSectionHeader />;
  if (routeKey === 'manuals') return <ManualsSidebar />;

  if (routeKey === 'tech') {
    const techId = searchParams.get('staffId') || getPathStaffId(pathname, 'tech') || '1';
    return <TechSidebarPanel techId={techId} />;
  }

  if (routeKey === 'packer') {
    return <PackerSidebarPanel />;
  }

  return null;
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
            <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-blue-500'}`} />
            <span className="text-[11px] font-black uppercase tracking-wider">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardSidebar({ inDrawer = false, onNavigate }: { inDrawer?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = getSidebarRouteKey(pathname);
  const [stationDetailsOpen, setStationDetailsOpen] = useState(false);
  const dashboardOpenOrderId =
    routeKey === 'dashboard' ? parseDashboardOpenOrderId(searchParams.get('openOrderId')) : null;
  const collapseDesktopSidebar =
    routeKey === 'dashboard' ? dashboardOpenOrderId != null : stationDetailsOpen;
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [canShowMobileSidebar, setCanShowMobileSidebar] = useState(false);
  const [showHomeNavigation, setShowHomeNavigation] = useState(false);
  const [lastTechHref, setLastTechHref] = useState('/tech?staffId=1');
  const [lastPackerHref, setLastPackerHref] = useState('/packer?staffId=4');

  useEffect(() => {
    const syncMobileSidebarAvailability = () => {
      const nextCanShow = window.innerWidth >= MOBILE_SIDEBAR_MIN_WIDTH && window.innerWidth < 768;
      setCanShowMobileSidebar(nextCanShow);
      if (!nextCanShow) setIsMobileOpen(false);
    };

    syncMobileSidebarAvailability();
    window.addEventListener('resize', syncMobileSidebarAvailability);
    return () => window.removeEventListener('resize', syncMobileSidebarAvailability);
  }, []);

  useEffect(() => {
    const savedTechHref = localStorage.getItem('last-tech-station-href');
    if (savedTechHref) {
      const legacyId = savedTechHref.match(/^\/tech\/(\d+)$/)?.[1];
      if (legacyId) setLastTechHref(`/tech?staffId=${legacyId}`);
      else if (/^\/tech(\?.*)?$/.test(savedTechHref)) setLastTechHref(savedTechHref);
    }
    const savedPackerHref = localStorage.getItem('last-packer-station-href');
    if (savedPackerHref) {
      const legacyId = savedPackerHref.match(/^\/packer\/(\d+)$/)?.[1];
      if (legacyId) setLastPackerHref(`/packer?staffId=${legacyId}`);
      else if (/^\/packer(\?.*)?$/.test(savedPackerHref)) setLastPackerHref(savedPackerHref);
    }
  }, []);

  const prevPathnameRef = useRef(pathname);

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
    // Only close the details panel on actual route changes, not search param
    // updates (e.g. openOrderId changing during up/down navigation).
    if (prevPathnameRef.current !== pathname) {
      setStationDetailsOpen(false);
      prevPathnameRef.current = pathname;
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleOpenDetails = () => {
      setStationDetailsOpen(true);
      setIsMobileOpen(false);
    };
    const handleCloseDetails = () => setStationDetailsOpen(false);
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

  const sidebarTitle = getSidebarTitle(pathname);

  const groupedNav = {
    main: APP_SIDEBAR_NAV.filter((item) => item.kind === 'main'),
    station: APP_SIDEBAR_NAV.filter((item) => item.kind === 'station'),
    bottom: APP_SIDEBAR_NAV.filter((item) => item.kind === 'bottom'),
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 } },
  };

  const shell = (
    <aside className="h-full w-full bg-white border-r border-gray-300 overflow-hidden shadow-xl shadow-gray-900/5 flex flex-col">
      <div className="flex-1 overflow-hidden">
        {inDrawer || showHomeNavigation || routeKey === 'unknown' ? (
          <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col bg-white">
            <div
              className={`flex-1 overflow-y-auto px-3 space-y-6 ${
                inDrawer
                  ? 'pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))]'
                  : 'pt-3'
              } pb-3`}
            >
              <motion.div variants={itemVariants}>
                <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-blue-600">Main</p>
                <NavSection items={groupedNav.main} pathname={pathname} resolveHref={resolveHref} onNavigate={() => { setShowHomeNavigation(false); onNavigate?.(); }} />
              </motion.div>
              <motion.div variants={itemVariants}>
                <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">Stations</p>
                <NavSection items={groupedNav.station} pathname={pathname} resolveHref={resolveHref} onNavigate={() => { setShowHomeNavigation(false); onNavigate?.(); }} />
              </motion.div>
              <motion.div variants={itemVariants}>
                <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">More</p>
                <NavSection items={groupedNav.bottom} pathname={pathname} resolveHref={resolveHref} onNavigate={() => { setShowHomeNavigation(false); onNavigate?.(); }} />
              </motion.div>
            </div>
            <motion.div
              variants={itemVariants}
              className={`flex-shrink-0 ${inDrawer ? 'pb-[max(1rem,env(safe-area-inset-bottom))]' : ''}`}
            >
              <DeviceModeToggle />
            </motion.div>
          </motion.div>
        ) : (
          <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden bg-white">
            <motion.button
              variants={itemVariants}
              type="button"
              onClick={() => setShowHomeNavigation(true)}
              className="w-full flex min-h-[44px] items-center gap-2 border-b border-gray-200 py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-gray-50"
              aria-label="Back to navigation"
            >
              <div className="h-9 w-7 flex items-center justify-start text-gray-500">
                <ChevronLeft className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black tracking-tight text-gray-900 truncate">{sidebarTitle}</p>
              </div>
            </motion.button>
            <motion.div variants={itemVariants} className="flex-1 overflow-hidden">
              <SidebarContextPanel />
            </motion.div>
          </motion.div>
        )}
      </div>
    </aside>
  );

  // When rendered inside ResponsiveLayout's mobile drawer, just render the
  // shell directly — the drawer handles positioning, backdrop, and close.
  if (inDrawer) {
    return shell;
  }

  return (
    <>
      <div
        className={`hidden md:block h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 ${
          collapseDesktopSidebar ? 'w-0' : 'w-[360px]'
        }`}
      >
        {shell}
      </div>

      {collapseDesktopSidebar && (
        <button
          type="button"
          onClick={() => dispatchCloseShippedDetails()}
          className="hidden md:flex fixed top-4 left-4 z-[90] h-11 w-11 rounded-2xl bg-white border border-gray-400 text-gray-700 shadow-lg shadow-gray-900/10 items-center justify-center"
          aria-label="Open station navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {canShowMobileSidebar && (
        <button
          type="button"
          onClick={() => setIsMobileOpen(true)}
          className="md:hidden fixed top-4 left-4 z-[90] h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-gray-900/10 flex items-center justify-center"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {canShowMobileSidebar && isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-[100]">
          <button type="button" className="absolute inset-0 bg-gray-900/35" onClick={() => setIsMobileOpen(false)} aria-label="Close sidebar overlay" />
          <div className="relative h-full max-w-[94vw]">{shell}</div>
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="absolute top-4 right-4 h-11 w-11 rounded-2xl bg-white border border-gray-400 text-gray-700 shadow-lg shadow-gray-900/10 flex items-center justify-center"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}
