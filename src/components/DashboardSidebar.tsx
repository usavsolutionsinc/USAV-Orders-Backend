'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, ChevronDown, Clock, LayoutDashboard, Menu, PackageCheck, X } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/admin-sections';
import { WarehouseSidebarPanel } from '@/components/sidebar/WarehouseSidebarPanel';
import { QuarterSidebar } from '@/components/QuarterSelector';
import { DashboardManagementPanel } from '@/components/sidebar/DashboardManagementPanel';
import { RepairSidebarPanel } from '@/components/sidebar/RepairSidebarPanel';
import { WalkInSidebarPanel } from '@/components/sidebar/WalkInSidebarPanel';
import ShippedSidebar from '@/components/ShippedSidebar';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import { ManualsLibrarySidebar } from '@/components/manuals/ManualsLibrarySidebar';
import { ProductsSidebarPanel } from '@/components/sidebar/ProductsSidebarPanel';
import { TechSidebarPanel } from '@/components/sidebar/TechSidebarPanel';
import { PackerSidebarPanel } from '@/components/sidebar/PackerSidebarPanel';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { InventorySidebarPanel } from '@/components/sidebar/InventorySidebarPanel';
import { FbaSidebarPanel } from '@/components/fba/sidebar';
import { SupportSidebarPanel } from '@/components/sidebar/SupportSidebarPanel';
import { SettingsSidebarPanel } from '@/components/sidebar/SettingsSidebarPanel';
import { AuditLogSidebarPanel } from '@/components/sidebar/AuditLogSidebarPanel';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { useAuth } from '@/contexts/AuthContext';
import {
  getSidebarRouteKey,
  getSidebarNavItems,
  isSidebarNavActive,
  type SidebarNavItem,
  APP_SIDEBAR_NAV,
} from '@/lib/sidebar-navigation';
import type { ShippedFormData } from '@/components/shipped';
import { dispatchCloseShippedDetails, DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM } from '@/utils/events';
import { getDashboardOrderViewFromSearch, parseDashboardOpenOrderId } from '@/utils/dashboard-search-state';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
const MOBILE_SIDEBAR_MIN_WIDTH = 420;

// Sub-views shown above the search bar.
const DASHBOARD_ORDERS_SUBVIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'pending',   label: 'Pending',  icon: Clock },
  { id: 'shipped',   label: 'Shipped',  icon: PackageCheck },
  { id: 'unshipped', label: 'Awaiting', icon: AlertCircle },
];

// Type filter shown only on the Shipped sub-view. FBA lives here now (it used
// to be a top-level group pill) — the shipped table already filters its records
// by this value (see DashboardShippedTable `shippedFilter`).
const DASHBOARD_SHIPPED_TYPE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all',    label: 'All' },
  { id: 'orders', label: 'Orders' },
  { id: 'sku',    label: 'SKU' },
  { id: 'fba',    label: 'FBA' },
];

function getSidebarTitle(pathname: string | null) {
  const routeKey = getSidebarRouteKey(pathname);
  const titles: Record<string, string> = {
    dashboard: 'Orders / Shipping',
    operations: 'Operations',
    fba: 'Amazon FBA',
    receiving: 'Receiving',
    repair: 'Repair',
    'walk-in': 'Walk-In',
    'work-orders': 'Work Orders',
    replenish: 'Replenish',
    inventory: 'Inventory',
    products: 'Products',
    warehouse: 'Warehouse',
    tech: 'Testing',
    packer: 'Packing',
    support: 'Support',
    'previous-quarters': 'Quarters',
    admin: 'Admin',
    'audit-log': 'Audit Log',
    settings: 'Settings',
  };
  return titles[routeKey] ?? 'Home';
}

function SidebarContextPanel({ onBackToAppNav }: { onBackToAppNav?: () => void } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
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
    const focusShippedSearch = searchParams.get(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM) === '1';
    const filterControl = (
      // Each pill row is its own 40px band — same pattern as the sidebar title
      // header (h-[40px] + border-b, border-box) so the divider is INSIDE the
      // 40px and the rows line up exactly with the rest of the 40px grid.
      <div className="shrink-0 bg-white">
        <div className="flex h-[40px] items-center border-b border-gray-300 px-3">
          <HorizontalButtonSlider
            items={DASHBOARD_ORDERS_SUBVIEW_ITEMS}
            value={dashboardSearch.orderView}
            onChange={(view) => dashboardSearch.setOrderView(view as typeof dashboardSearch.orderView)}
            variant="nav"
            dense
            aria-label="Orders view"
            className="w-full"
          />
        </div>
        {dashboardSearch.orderView === 'shipped' ? (
          // Type filter for the Shipped tab (All / Orders / SKU / FBA).
          <div className="flex h-[40px] items-center border-b border-gray-300 px-3">
            <HorizontalButtonSlider
              items={DASHBOARD_SHIPPED_TYPE_ITEMS}
              value={dashboardSearch.shippedFilter}
              onChange={(value) =>
                dashboardSearch.setShippedFilter(value as typeof dashboardSearch.shippedFilter)
              }
              variant="nav"
              dense
              aria-label="Shipped type filter"
              className="w-full"
            />
          </div>
        ) : null}
      </div>
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
          shippedSearchField={dashboardSearch.shippedSearchField}
          onShippedSearchFieldChange={dashboardSearch.setShippedSearchField}
          autoFocusSearch={focusShippedSearch}
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

  if (routeKey === 'admin') {
    const activeSection = (searchParams.get('section') as AdminSection) || 'overview';
    const validSection = ADMIN_SECTION_OPTIONS.some((item) => item.value === activeSection) ? activeSection : 'overview';

    return (
      <div className="h-full overflow-hidden">
        <AdminSidebar
          activeSection={validSection}
          onSectionChange={(nextSection) => {
            if (nextSection === 'overview') {
              // Clear ?section so deep-links/back-button land cleanly on overview.
              updateSearch((params) => { params.delete('section'); }, '/admin');
            } else {
              updateSearch((params) => { params.set('section', nextSection); }, '/admin');
            }
          }}
        />
      </div>
    );
  }

  if (routeKey === 'support') return <SupportSidebarPanel />;
  if (routeKey === 'settings') return <SettingsSidebarPanel />;
  if (routeKey === 'audit-log') return <AuditLogSidebarPanel />;
  if (routeKey === 'receiving') return <ReceivingSidebarPanel />;
  if (routeKey === 'fba') return <FbaSidebarPanel />;
  // /inventory's main shell owns its own header search + filter chips; the
  // panel here carries the section toggle (Inventory ↔ Replenish) plus the
  // tabbed inventory / replenish sidebars.
  if (routeKey === 'inventory') return <InventorySidebarPanel />;
  if (routeKey === 'products') return <ProductsSidebarPanel />;
  if (routeKey === 'warehouse') return <WarehouseSidebarPanel />;
  if (routeKey === 'walk-in') return <WalkInSidebarPanel embedded hideSectionHeader />;
  if (routeKey === 'repair') return <WalkInSidebarPanel embedded hideSectionHeader />;
  if (routeKey === 'previous-quarters') return <QuarterSidebar hideSectionHeader />;
  if (routeKey === 'manuals-library') return <ManualsLibrarySidebar />;

  if (routeKey === 'tech') {
    // Identity from the verified session cookie. Proxy guarantees user.
    const techId = String(user?.staffId ?? 0);
    return (
      <TechSidebarPanel
        techId={techId}
        onBackToAppNav={onBackToAppNav}
        contextNavTitle={getSidebarTitle(pathname)}
      />
    );
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
    <div className="space-y-0.5">
      {items.map((item) => {
        const href = resolveHref(item);
        const isActive = isSidebarNavActive(pathname, href);
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={href}
            onClick={onNavigate}
            prefetch={process.env.NODE_ENV === 'production'}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
            <span className="flex-1 text-caption font-black uppercase tracking-wider">{item.label}</span>
            {isActive && <Check className="h-4 w-4 shrink-0 text-white/80" />}
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardSidebar({ inDrawer = false, onNavigate }: { inDrawer?: boolean; onNavigate?: () => void }) {
  const { isMobile } = useUIMode();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = getSidebarRouteKey(pathname);
  const [stationDetailsOpen, setStationDetailsOpen] = useState(false);
  const dashboardOrderView =
    routeKey === 'dashboard' ? getDashboardOrderViewFromSearch(searchParams) : null;
  const dashboardOpenOrderId =
    routeKey === 'dashboard' ? parseDashboardOpenOrderId(searchParams.get('openOrderId')) : null;
  // Details panel is a fixed overlay (z-[100]) — never collapse the sidebar for it.
  const collapseDesktopSidebar = false;
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [canShowMobileSidebar, setCanShowMobileSidebar] = useState(false);
  // Dropdown state: when open, the sidebar shows the full list of pages; when
  // closed, it shows the active page's context panel with the current tab
  // pinned at the top as the dropdown trigger.
  const [navOpen, setNavOpen] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);
  const openNav = useCallback(() => setNavOpen(true), []);
  const toggleNav = useCallback(() => setNavOpen((open) => !open), []);

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

  // Phase F: no more per-station-href memory. The tech/packer hrefs are
  // canonical (/tech, /packer) and identity comes from the session cookie.
  // Stale localStorage keys are wiped one-shot by AuthProvider on mount.

  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    if (!pathname) return;
    setNavOpen(false);
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
    if (item.id === 'tech') return '/tech';
    if (item.id === 'packer') return '/packer';
    return item.href;
  };

  const sidebarTitle = getSidebarTitle(pathname);

  const { user: authUser, isLoaded: authLoaded } = useAuth();
  // Only apply permission filtering once auth has loaded AND the user is
  // signed in. Pre-sign-in (or while auth resolves) we render the full nav
  // so the legacy `?staffId=…` flow keeps working during rollout.
  const authPermissions = React.useMemo<Set<string> | undefined>(() => {
    if (!authLoaded || !authUser) return undefined;
    return new Set(authUser.permissions);
  }, [authLoaded, authUser]);

  const visibleNavItems = getSidebarNavItems({
    mobileRestricted: isMobile,
    permissions: authPermissions,
  });

  // On mobile inside receiving/packing, collapse the nav to just Home (/m/home)
  // plus the current station — the rest is noise while you're heads-down at a
  // workstation, and the cockpit lives at /m/home anyway.
  const isMobileStationLockdown =
    isMobile && (routeKey === 'receiving' || routeKey === 'packer');

  const groupedNav = isMobileStationLockdown
    ? {
        main: [
          {
            id: 'home',
            label: 'Home',
            href: '/m/home',
            icon: LayoutDashboard,
            kind: 'main' as const,
          } satisfies SidebarNavItem,
        ],
        station: visibleNavItems.filter((item) => item.id === routeKey),
        bottom: [] as SidebarNavItem[],
      }
    : {
        main: visibleNavItems.filter((item) => item.kind === 'main'),
        station: visibleNavItems.filter((item) => item.kind === 'station'),
        bottom: visibleNavItems.filter((item) => item.kind === 'bottom'),
      };

  const currentNavItem = APP_SIDEBAR_NAV.find((item) => item.id === routeKey);
  const CurrentIcon = currentNavItem?.icon ?? LayoutDashboard;

  // The dropdown is forced open when there is no context to show: inside the
  // mobile drawer (it's a pure menu) or on an unknown route.
  const isOpen = navOpen || inDrawer || routeKey === 'unknown';
  const handlePickFromNav = () => { closeNav(); onNavigate?.(); };

  const shell = (
    <aside className="h-full w-full bg-white border-r border-gray-300 overflow-hidden shadow-xl shadow-gray-900/5 flex flex-col">
      {/* Pinned trigger — the currently selected page stays at the top of the
          sidebar and toggles the dropdown list of every other page. */}
      <button
        type="button"
        onClick={toggleNav}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        className={`group w-full flex h-[40px] items-center gap-3 px-3 py-2 text-left border-b border-gray-300 transition-colors hover:bg-gray-50 ${
          inDrawer ? 'h-auto pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))] pb-2' : ''
        }`}
      >
        <CurrentIcon className="h-5 w-5 shrink-0 text-blue-600" />
        <span className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-wider text-gray-900">
          {sidebarTitle}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence initial={false} mode="wait">
          {isOpen ? (
            <motion.div
              key="navigation"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute inset-0 flex flex-col bg-white"
            >
              <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 space-y-5">
                {groupedNav.main.length > 0 && (
                  <div>
                    <p className="px-1 pb-1.5 text-eyebrow font-black uppercase tracking-[0.25em] text-blue-600">Main</p>
                    <NavSection items={groupedNav.main} pathname={pathname} resolveHref={resolveHref} onNavigate={handlePickFromNav} />
                  </div>
                )}
                {groupedNav.station.length > 0 && (
                  <div>
                    <p className="px-1 pb-1.5 text-eyebrow font-black uppercase tracking-[0.25em] text-gray-500">Stations</p>
                    <NavSection items={groupedNav.station} pathname={pathname} resolveHref={resolveHref} onNavigate={handlePickFromNav} />
                  </div>
                )}
                {groupedNav.bottom.length > 0 && (
                  <div>
                    <p className="px-1 pb-1.5 text-eyebrow font-black uppercase tracking-[0.25em] text-gray-500">More</p>
                    <NavSection items={groupedNav.bottom} pathname={pathname} resolveHref={resolveHref} onNavigate={handlePickFromNav} />
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="context"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="absolute inset-0 flex flex-col overflow-hidden bg-white"
            >
              <SidebarContextPanel onBackToAppNav={openNav} />
            </motion.div>
          )}
        </AnimatePresence>
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

      {/* Floating mobile menu button removed — now handled by header nav buttons */}

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
