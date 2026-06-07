'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { Plus } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useWarrantyClaims, useWarrantyUrlState } from '@/hooks/useWarrantyClaims';
import { WARRANTY_CLAIM_STATUSES, WARRANTY_STATUS_LABEL, type WarrantyClaimStatus } from '@/lib/warranty/types';
import { WarrantyClockChip, WarrantyStatusBadge } from '@/components/warranty/chips';
import { WarrantyLogClaimDialog } from '@/components/warranty/WarrantyLogClaimDialog';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface WarrantyLoggerSidebarProps {
  /** Legacy in-panel mode rail (rendered only when master nav is off). */
  filterControl?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

const STATUS_FILTER_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  ...WARRANTY_CLAIM_STATUSES.map((s) => ({ id: s, label: WARRANTY_STATUS_LABEL[s] })),
];

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

  const statusRow = (
    <HorizontalButtonSlider
      items={STATUS_FILTER_ITEMS}
      value={status ?? 'all'}
      onChange={(id) => setStatus(id === 'all' ? null : (id as WarrantyClaimStatus))}
      variant="segmented"
      dense
      aria-label="Warranty status filter"
      className="w-full"
    />
  );

  const expiringRow = (
    <button
      type="button"
      onClick={() => setExpiringSoon(!expiringSoon)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition',
        expiringSoon
          ? 'bg-rose-100 text-rose-700 ring-rose-200'
          : 'bg-white text-gray-500 ring-gray-200 hover:bg-gray-50',
      )}
      aria-pressed={expiringSoon}
    >
      Expiring soon
    </button>
  );

  const summary = useMemo(() => {
    if (isLoading) return 'Loading…';
    if (error) return 'Failed to load claims';
    const n = claims.length;
    return `${n} claim${n === 1 ? '' : 's'}`;
  }, [isLoading, error, claims.length]);

  const exportHref = `/api/warranty/reports/export${status ? `?status=${status}` : ''}`;

  const logClaimButton = (
    <div className="flex items-center justify-end gap-2 px-1 pb-1">
      <a
        href={exportHref}
        className="inline-flex items-center rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        Export
      </a>
      <button
        type="button"
        onClick={() => setLogOpen(true)}
        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Log Claim
      </button>
    </div>
  );

  return (
    <>
    <SidebarShell
      headerAbove={
        <>
          {filterControl}
          {logClaimButton}
        </>
      }
      search={{
        value: searchValue,
        onChange: (v) => onSearchChange?.(v),
        placeholder: 'Search claim #, serial, SKU, order, customer…',
        isSearching: isFetching && !isLoading,
      }}
      headerRows={[
        statusRow,
        <div key="exp" className="flex items-center justify-between">
          {expiringRow}
          <span className={cn(sectionLabel, 'text-gray-400')}>{summary}</span>
        </div>,
      ]}
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
