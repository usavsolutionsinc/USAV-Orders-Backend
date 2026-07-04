'use client';

import { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Plus } from '@/components/Icons';
import { DashboardShippedSearchHandoffCard } from '@/components/dashboard/DashboardShippedSearchHandoffCard';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { ShippedIntakeForm, type ShippedFormData } from '@/components/shipped';
import { useAuth } from '@/contexts/AuthContext';
import { OrderSyncDialog } from '@/components/sidebar/OrderSyncDialog';
import { containerVariants, itemVariants } from './dashboard-management/dashboard-management-shared';
import { useDashboardSearchHistory } from './dashboard-management/useDashboardSearchHistory';
import { useOrdersImport } from './dashboard-management/useOrdersImport';
import { OrdersImportCard } from './dashboard-management/OrdersImportCard';
import { SyncStatusBanner } from './dashboard-management/SyncStatusBanner';

interface DashboardManagementPanelProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onOpenShippedMatches?: (searchQuery: string) => void;
}

/**
 * Dashboard sidebar management panel — search + recent searches + order import
 * (Sheets/Ecwid/exceptions). Thin composition layer: search lives in
 * {@link useDashboardSearchHistory}, the import stream in {@link useOrdersImport};
 * the cards live under `./dashboard-management/`.
 */
export function DashboardManagementPanel({
  showIntakeForm = false,
  onCloseForm,
  onFormSubmit,
  filterControl,
  searchValue = '',
  onSearchChange,
  onOpenShippedMatches,
}: DashboardManagementPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { has } = useAuth();
  const canImportOrders = has('orders.import');

  const s = useDashboardSearchHistory(searchValue, onSearchChange);
  const imp = useOrdersImport();

  const handleOpenIntakeForm = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('new', 'true');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname || '/dashboard'}?${nextSearch}` : pathname || '/dashboard');
  };

  if (showIntakeForm) {
    return <ShippedIntakeForm onClose={onCloseForm || (() => {})} onSubmit={onFormSubmit || (() => {})} />;
  }

  return (
    <>
      <SidebarShell
        as={motion.div}
        containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
        headerAbove={filterControl ? <motion.div variants={itemVariants} className="relative z-20">{filterControl}</motion.div> : null}
        search={{
          value: s.searchQuery,
          onChange: s.handleInputChange,
          onClear: () => { s.setSearchQuery(''); s.handleSearch(''); },
          inputRef: s.searchInputRef,
          placeholder: 'Search order ID, tracking, SKU, title, customer...',
          variant: 'blue',
          rightElement: (
            <HoverTooltip label="New Order Entry" asChild>
            <IconButton
              ariaLabel="Open new order entry form"
              onClick={handleOpenIntakeForm}
              className="rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600 disabled:bg-surface-strong"
              icon={<Plus className="h-5 w-5" />}
            />
            </HoverTooltip>
          ),
        }}
        bodyClassName="flex flex-col space-y-6 scrollbar-hide pb-6"
      >
        <div className="space-y-4">
          <motion.div variants={itemVariants} className="-mt-2">
            <DashboardShippedSearchHandoffCard searchQuery={s.searchQuery} onOpenShippedMatches={onOpenShippedMatches} />
          </motion.div>
          <motion.div variants={itemVariants} className="-mt-1">
            <RecentSearchesList
              items={s.visibleSearchHistory}
              totalCount={s.searchHistory.length}
              expanded={s.showAllSearchHistory}
              onToggleExpanded={() => s.setShowAllSearchHistory((current) => !current)}
              onClear={s.clearSearchHistory}
              onSelect={(query) => {
                s.setSearchQuery(query);
                s.handleSearch(query);
              }}
            />
          </motion.div>
          <motion.div variants={itemVariants} className="space-y-3">
            <OrdersImportCard imp={imp} canImportOrders={canImportOrders} />
          </motion.div>

          <SyncStatusBanner status={imp.status} onDismiss={() => imp.setStatus(null)} />
        </div>
      </SidebarShell>

      <OrderSyncDialog
        open={imp.isSyncDialogOpen}
        onClose={() => imp.setIsSyncDialogOpen(false)}
        isRunning={imp.isTransferring}
        elapsedMs={imp.elapsedMs}
        onCancel={imp.handleCancelTransfer}
        sheets={imp.sheetsTask}
        ecwid={imp.ecwidTask}
        exceptions={imp.exceptionsTask}
      />
    </>
  );
}
