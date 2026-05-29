'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronUp, Clock, LayoutDashboard, Menu, Package, PackageCheck, X } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
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
import { WorkOrdersSidebarPanel } from '@/components/sidebar/WorkOrdersSidebarPanel';
import { ReplenishSidebarPanel } from '@/components/sidebar/ReplenishSidebarPanel';
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
import { getDashboardOrderViewFromSearch, getDashboardViewGroup, parseDashboardOpenOrderId } from '@/utils/dashboard-search-state';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
const MOBILE_SIDEBAR_MIN_WIDTH = 420;

// Top-level groups. Pending / Shipped / Awaiting are all orders data, so they
// collapse under one "Shipping" pill; FBA is a separate data source.
const DASHBOARD_GROUP_ITEMS: HorizontalSliderItem[] = [
  { id: 'orders', label: 'Shipping', icon: PackageCheck },
  { id: 'fba',    label: 'FBA',      icon: Package },
];

// Sub-views shown above the search bar when the "Shipping" group is active.
const DASHBOARD_ORDERS_SUBVIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'pending',   label: 'Pending',  icon: Clock },
  { id: 'shipped',   label: 'Shipped',  icon: PackageCheck },
  { id: 'unshipped', label: 'Awaiting', icon: AlertCircle },
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
    const activeGroup = getDashboardViewGroup(dashboardSearch.orderView);
    const focusShippedSearch = searchParams.get(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM) === '1';
    const filterControl = (
      <div className={`${sidebarHeaderBandClass} px-3`}>
        <div className="py-2">
          <HorizontalButtonSlider
            items={DASHBOARD_GROUP_ITEMS}
            value={activeGroup}
            onChange={(group) => dashboardSearch.setOrderView(group === 'fba' ? 'fba' : 'pending')}
            variant="nav"
            aria-label="Dashboard view"
          />
        </div>
        {activeGroup === 'orders' ? (
          <>
            {/* Full-width rule, with matched padding above and below so both
                pill rows sit at the same distance from the divider. */}
            <div className="-mx-3 border-t border-gray-200" />
            <div className="py-2">
              <HorizontalButtonSlider
                items={DASHBOARD_ORDERS_SUBVIEW_ITEMS}
                value={dashboardSearch.orderView}
                onChange={(view) => dashboardSearch.setOrderView(view as typeof dashboardSearch.orderView)}
                variant="nav"
                aria-label="Orders view"
              />
            </div>
          </>
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
  if (routeKey === 'work-orders') return <WorkOrdersSidebarPanel />;
  if (routeKey === 'replenish') return <ReplenishSidebarPanel />;
  // /inventory's main shell owns its own header search + filter chips, but
  // we still mount a small sidebar panel here so the section nav pills
  // (Inventory ↔ PO Mailbox) live in the standard sidebar slot like every
  // other section.
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
            prefetch={process.env.NODE_ENV === 'production'}
            className="group block relative"
          >
            {isActive && (
              <motion.div
                layoutId="active-sidebar-bar"
                className="absolute inset-0 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20"
                transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              />
            )}
            <div
              className={`relative flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 ${
                isActive ? 'text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <motion.div layoutId={isActive ? 'sidebar-icon' : undefined}>
                <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-blue-500'}`} />
              </motion.div>
              <motion.span
                layoutId={isActive ? 'sidebar-title' : undefined}
                className="flex-1 text-caption font-black uppercase tracking-wider"
              >
                {item.label}
              </motion.span>
              <motion.div layoutId={isActive ? 'sidebar-arrow' : undefined} className="flex items-center">
                {isActive ? (
                  <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-white/70" />
                ) : (
                  <ChevronUp className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400" />
                )}
              </motion.div>
            </div>
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
  const [showHomeNavigation, setShowHomeNavigation] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<'up' | 'down'>('up');

  const navigateToContext = useCallback(() => {
    setTransitionDirection('up');
    setShowHomeNavigation(false);
  }, []);

  const navigateToHome = useCallback(() => {
    setTransitionDirection('down');
    setShowHomeNavigation(true);
  }, []);

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

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1,
      },
    },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 15, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 30, stiffness: 350, mass: 0.6 },
    },
  };

  const currentNavItem = APP_SIDEBAR_NAV.find((item) => item.id === routeKey);
  const CurrentIcon = currentNavItem?.icon ?? LayoutDashboard;

  const shell = (
    <aside className="h-full w-full bg-white border-r border-gray-300 overflow-hidden shadow-xl shadow-gray-900/5 flex flex-col">
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence initial={false} custom={transitionDirection}>
          {inDrawer || showHomeNavigation || routeKey === 'unknown' ? (
            <motion.div
              key="navigation"
              custom={transitionDirection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              variants={containerVariants}
              className="h-full flex flex-col bg-white"
            >
              <div
                className={`flex-1 overflow-y-auto px-3 space-y-6 ${
                  inDrawer
                    ? 'pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))]'
                    : 'pt-3'
                } pb-3`}
              >
                {groupedNav.main.length > 0 && (
                  <motion.div variants={itemVariants}>
                    <p className="px-1 pb-2 text-eyebrow font-black uppercase tracking-[0.25em] text-blue-600">Main</p>
                    <NavSection items={groupedNav.main} pathname={pathname} resolveHref={resolveHref} onNavigate={() => { navigateToContext(); onNavigate?.(); }} />
                  </motion.div>
                )}
                {groupedNav.station.length > 0 && (
                  <motion.div variants={itemVariants}>
                    <p className="px-1 pb-2 text-eyebrow font-black uppercase tracking-[0.25em] text-gray-500">Stations</p>
                    <NavSection items={groupedNav.station} pathname={pathname} resolveHref={resolveHref} onNavigate={() => { navigateToContext(); onNavigate?.(); }} />
                  </motion.div>
                )}
                {groupedNav.bottom.length > 0 && (
                  <motion.div variants={itemVariants}>
                    <p className="px-1 pb-2 text-eyebrow font-black uppercase tracking-[0.25em] text-gray-500">More</p>
                    <NavSection items={groupedNav.bottom} pathname={pathname} resolveHref={resolveHref} onNavigate={() => { navigateToContext(); onNavigate?.(); }} />
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="context"
              custom={transitionDirection}
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={containerVariants}
              className="h-full flex flex-col overflow-hidden bg-white"
            >
              <button
                type="button"
                onClick={navigateToHome}
                className="group relative w-full flex min-h-[44px] items-center text-left transition-colors hover:bg-gray-50 z-20"
                aria-label="Back to navigation"
              >
                <motion.div
                  layoutId="active-sidebar-bar"
                  className="absolute inset-0 border-b border-gray-200 bg-white"
                  transition={{ type: 'spring', damping: 30, stiffness: 350 }}
                />
                <div className="relative flex w-full items-center gap-3 px-3 py-3 z-10">
                  <motion.div layoutId="sidebar-icon">
                    <CurrentIcon className="h-5 w-5 text-blue-600" />
                  </motion.div>
                  <div className="min-w-0 flex-1">
                    <motion.p
                      layoutId="sidebar-title"
                      className="text-sm font-black tracking-tight text-gray-900 truncate uppercase tracking-wider"
                    >
                      {sidebarTitle}
                    </motion.p>
                  </div>
                  <motion.div layoutId="sidebar-arrow">
                    <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400" />
                  </motion.div>
                </div>
              </button>
              <motion.div 
                variants={itemVariants} 
                className="flex-1 overflow-hidden"
                transition={{ delay: 0.25 }}
              >
                <SidebarContextPanel onBackToAppNav={navigateToHome} />
              </motion.div>
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
