'use client';

import { type ReactNode, useState } from 'react';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { FilterBar } from '@/design-system/components/FilterBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { Plus } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useWarrantyClaims, useWarrantyUrlState, WARRANTY_EXPIRING_SOON_DAYS } from '@/hooks/useWarrantyClaims';
import { WARRANTY_CLAIM_STATUSES, WARRANTY_STATUS_LABEL, type WarrantyClaimStatus } from '@/lib/warranty/types';
import { WarrantyClockChip, WarrantyStatusBadge } from '@/components/warranty/chips';
import { WarrantyLogClaimDialog } from '@/components/warranty/WarrantyLogClaimDialog';

interface WarrantyLoggerSidebarProps {
  /** Legacy in-panel mode rail (rendered only when master nav is off). */
  filterControl?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

/** Top-of-popover sort bar: full warranty window vs. the 30-day expiry horizon. */
const EXPIRY_SORT_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  { id: 'soon', label: `${WARRANTY_EXPIRING_SOON_DAYS} days out` },
];

const statusChip = 'rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition';
const statusChipActive = 'bg-blue-600 text-white ring-blue-600';
const statusChipIdle = 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50';

export function WarrantyLoggerSidebar({
  filterControl,
  searchValue = '',
  onSearchChange,
}: WarrantyLoggerSidebarProps) {
  const { status, expiringSoon, openClaimId, setStatus, setExpiringSoon, openClaim } = useWarrantyUrlState();
  const [logOpen, setLogOpen] = useState(false);

  const { data: claims = [], isLoading, isFetching, error } = useWarrantyClaims({
    status,
    search: searchValue,
    expiringSoon,
  });

  const activeFilterCount = (status ? 1 : 0) + (expiringSoon ? 1 : 0);

  // Popover body: the "30 days out" sort bar pinned on top, status filter below.
  const renderFilters = () => (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Expiry</p>
        <HorizontalButtonSlider
          items={EXPIRY_SORT_ITEMS}
          value={expiringSoon ? 'soon' : 'all'}
          onChange={(id) => setExpiringSoon(id === 'soon')}
          variant="segmented"
          dense
          aria-label="Warranty expiry filter"
          className="w-full"
        />
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStatus(null)}
            className={cn(statusChip, status === null ? statusChipActive : statusChipIdle)}
          >
            All
          </button>
          {WARRANTY_CLAIM_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s as WarrantyClaimStatus)}
              className={cn(statusChip, status === s ? statusChipActive : statusChipIdle)}
            >
              {WARRANTY_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const exportHref = `/api/warranty/reports/export${status ? `?status=${status}` : ''}`;

  const actionButtons = (
    <div className="flex items-stretch gap-2 px-1.5 pt-1.5">
      <a
        href={exportHref}
        className="inline-flex flex-1 items-center justify-center rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        Export
      </a>
      <button
        type="button"
        onClick={() => setLogOpen(true)}
        className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Log Claim
      </button>
    </div>
  );

  return (
    <>
    <SidebarShell
      headerAbove={filterControl}
      search={{
        value: searchValue,
        onChange: (v) => onSearchChange?.(v),
        placeholder: 'Search claim #, serial, SKU, order, customer…',
        isSearching: isFetching && !isLoading,
      }}
      headerBelow={
        <>
          <div className="px-1.5 pt-1.5">
            <FilterBar
              className="w-full"
              advanced={{
                fullWidth: true,
                label: 'Filters',
                activeCount: activeFilterCount,
                render: renderFilters,
              }}
            />
          </div>
          {actionButtons}
        </>
      }
    >
      {error ? (
        <div className="px-1 py-6 text-sm text-rose-600">
          {error instanceof Error ? error.message : 'Failed to load warranty claims.'}
        </div>
      ) : isLoading ? (
        <div className="px-1 py-6 text-sm text-gray-400">Loading warranty claims…</div>
      ) : claims.length === 0 ? (
        <div className="px-1 py-10 text-center text-sm text-gray-400">
          No warranty claims{status ? ` in ${WARRANTY_STATUS_LABEL[status]}` : ''}
          {expiringSoon ? ' expiring soon' : ''}.
        </div>
      ) : (
        <ul className="space-y-1.5 pb-6">
          {claims.map((claim) => {
            const selected = claim.id === openClaimId;
            const title = claim.productTitle || claim.sku || claim.serialNumber || claim.claimNumber;
            return (
              <li key={claim.id}>
                <button
                  type="button"
                  onClick={() => openClaim(selected ? null : claim.id)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition',
                    selected
                      ? 'border-blue-300 bg-blue-50/60 ring-1 ring-blue-200'
                      : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{title}</span>
                    <WarrantyStatusBadge status={claim.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px] text-gray-400">
                      {claim.claimNumber}
                      {claim.serialNumber ? ` · ${claim.serialNumber}` : ''}
                    </span>
                    <WarrantyClockChip daysRemaining={claim.daysRemaining} basis={claim.clockBasis} />
                  </div>
                  {claim.customerName && (
                    <div className="mt-0.5 truncate text-[11px] text-gray-400">{claim.customerName}</div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarShell>
    <WarrantyLogClaimDialog open={logOpen} onClose={() => setLogOpen(false)} onCreated={(id) => openClaim(id)} />
    </>
  );
}
