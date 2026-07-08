'use client';

import { useSearchParams } from 'next/navigation';
import { Inbox, PackageCheck, ShieldCheck } from '@/components/Icons';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { SidebarSection } from '@/components/layout/SidebarSection';
import ShippedSidebar from '@/components/ShippedSidebar';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import { WarrantyLoggerSidebar } from '@/components/warranty/WarrantyLoggerSidebar';
import { DashboardManagementPanel } from '@/components/sidebar/DashboardManagementPanel';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
import { DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM } from '@/utils/events';
import {
  useShippedFormSubmit,
  useUnshippedCount,
} from '@/components/sidebar/dashboard-sidebar-hooks';

/**
 * The Orders / Shipping route's context panel. Renders one of four orders
 * sub-views (Unshipped · Shipped · Warranty Logger · Management) selected by
 * the dashboard search controller's `orderView`, and supplies the legacy
 * in-panel switcher when the master-nav rail is disabled.
 *
 * Archetype note: the dashboard main region is an intentional pipeline-workbench
 * hybrid (see `UnshippedTable` / `.claude/rules/display/workbench.md`); this panel
 * is the stable sidebar picker/scope for that Workbench. The switcher exposes only
 * Unshipped/Shipped/Warranty by design — FBA (`?fba`) is owned by the top-level
 * `/fba` page and intentionally has no rail entry here.
 */
export function DashboardOrdersContextPanel() {
  const searchParams = useSearchParams();
  const dashboardSearch = useDashboardSearchController();
  const masterNavEnabled = useMasterNavEnabled();
  // This panel only mounts on the dashboard route, so the badge query is always on.
  const unshippedCount = useUnshippedCount(true);
  const submitShippedForm = useShippedFormSubmit(dashboardSearch.closeIntakeForm);

  const subviewItems: HorizontalSliderItem[] = [
    { id: 'unshipped', label: 'Unshipped', icon: Inbox, count: unshippedCount > 0 ? unshippedCount : undefined },
    { id: 'shipped', label: 'Shipped', icon: PackageCheck },
    { id: 'warranty', label: 'Warranty Logger', icon: ShieldCheck },
  ];

  // Legacy in-panel switcher — only when master nav is off (standalone / tests).
  const filterControl = masterNavEnabled ? null : (
    <SidebarSection band>
      <HorizontalButtonSlider
        items={subviewItems}
        value={dashboardSearch.orderView}
        onChange={(view) => dashboardSearch.setOrderView(view as typeof dashboardSearch.orderView)}
        variant="segmented"
        aria-label="Orders view"
        className="w-full"
      />
    </SidebarSection>
  );

  if (dashboardSearch.orderView === 'shipped') {
    const focusShippedSearch = searchParams.get(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM) === '1';
    return (
      <ShippedSidebar
        embedded
        hideSectionHeader
        showIntakeForm={dashboardSearch.showIntakeForm}
        onCloseForm={dashboardSearch.closeIntakeForm}
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
        onCloseForm={dashboardSearch.closeIntakeForm}
        onFormSubmit={submitShippedForm}
        filterControl={filterControl}
        searchValue={dashboardSearch.searchQuery}
        onSearchChange={dashboardSearch.setSearch}
        onOpenShippedMatches={dashboardSearch.openShippedMatches}
        onOpenLabelsMatches={dashboardSearch.openOutboundLabels}
      />
    );
  }

  if (dashboardSearch.orderView === 'warranty') {
    return (
      <WarrantyLoggerSidebar
        filterControl={filterControl}
        searchValue={dashboardSearch.searchQuery}
        onSearchChange={dashboardSearch.setSearch}
      />
    );
  }

  return (
    <DashboardManagementPanel
      showIntakeForm={dashboardSearch.showIntakeForm}
      onCloseForm={dashboardSearch.closeIntakeForm}
      onFormSubmit={submitShippedForm}
      filterControl={filterControl}
      searchValue={dashboardSearch.searchQuery}
      onSearchChange={dashboardSearch.setSearch}
      onOpenShippedMatches={dashboardSearch.openShippedMatches}
    />
  );
}
