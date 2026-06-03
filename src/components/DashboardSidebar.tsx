'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, Menu, PackageCheck, X } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SidebarSection } from '@/components/layout/SidebarSection';
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
import { AiChatSidebarPanel } from '@/components/sidebar/AiChatSidebarPanel';
import { SettingsSidebarPanel } from '@/components/sidebar/SettingsSidebarPanel';
import { AuditLogSidebarPanel } from '@/components/sidebar/AuditLogSidebarPanel';
import { MasterNav, MasterNavProvider } from '@/components/sidebar/master-nav';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { useAuth } from '@/contexts/AuthContext';
import { getSidebarRouteKey } from '@/lib/sidebar-navigation';
import type { ShippedFormData } from '@/components/shipped';
import { dispatchCloseShippedDetails, DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM } from '@/utils/events';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
const MOBILE_SIDEBAR_MIN_WIDTH = 420;

// Pages whose panels gate their own pill-row on useMasterNavEnabled() — only
// these show the master-nav L2 rail. dashboard/receiving/fba (heavy) keep their
// existing switchers until a later phase. Keep in sync with the gated panels.
const MASTER_NAV_RAIL_PAGES: ReadonlySet<string> = new Set([
  'inventory',
  'warehouse',
  'products',
  'walk-in',
  'tech',
]);

// Sub-views shown above the search bar.
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
    'ai-chat': 'AI Chat',
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
      // 40px pill band routed through the shared SidebarSection so it inherits
      // the one canonical left gutter (SIDEBAR_GUTTER) + hairline instead of a
      // hand-typed px-3 that drifts out of alignment with the rows below.
      <SidebarSection band>
        <HorizontalButtonSlider
          items={DASHBOARD_ORDERS_SUBVIEW_ITEMS}
          value={dashboardSearch.orderView}
          onChange={(view) => dashboardSearch.setOrderView(view as typeof dashboardSearch.orderView)}
          variant="segmented"
          aria-label="Orders view"
          className="w-full"
        />
      </SidebarSection>
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
  if (routeKey === 'ai-chat') return <AiChatSidebarPanel />;
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

export default function DashboardSidebar({ inDrawer = false, onNavigate }: { inDrawer?: boolean; onNavigate?: () => void }) {
  const { isMobile } = useUIMode();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stationDetailsOpen, setStationDetailsOpen] = useState(false);
  // Details panel is a fixed overlay (z-[100]) — never collapse the sidebar for it.
  const collapseDesktopSidebar = false;
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [canShowMobileSidebar, setCanShowMobileSidebar] = useState(false);

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

  const { user: authUser, isLoaded: authLoaded } = useAuth();
  // Only apply permission filtering once auth has loaded AND the user is
  // signed in. Pre-sign-in (or while auth resolves) we render the full nav
  // so the legacy `?staffId=…` flow keeps working during rollout.
  const authPermissions = React.useMemo<Set<string> | undefined>(() => {
    if (!authLoaded || !authUser) return undefined;
    return new Set(authUser.permissions);
  }, [authLoaded, authUser]);

  // The single master sidebar nav — one dropdown (recents on top, current page
  // hidden, grouped Main / Stations / More) plus the per-page L2 mode rail. The
  // MasterNavProvider tells the panels rendered in renderContext to hide their
  // own mode pills (the rail is the single switcher).
  // See docs/design-system/master-sidebar-nav-migration-plan.md.
  const shell = (
    <aside
      className={`h-full w-full bg-white border-r border-gray-300 overflow-hidden shadow-xl shadow-gray-900/5 flex flex-col ${
        // In the mobile drawer, inset the top so the header clears the notch /
        // status bar (parity with the old drawer trigger).
        inDrawer ? 'pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))]' : ''
      }`}
    >
      <MasterNavProvider enabled>
        <MasterNav
          permissions={authPermissions}
          mobileRestricted={isMobile}
          railPageIds={MASTER_NAV_RAIL_PAGES}
          onNavigate={onNavigate}
          renderContext={() => <SidebarContextPanel />}
          className="flex-1 min-h-0"
        />
      </MasterNavProvider>
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
