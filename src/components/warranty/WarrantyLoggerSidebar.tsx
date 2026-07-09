'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { Plus } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
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

const statusChip = 'rounded-full px-2.5 py-1 text-caption font-medium ring-1 ring-inset transition';
const statusChipActive = 'bg-accent-bg text-accent-text ring-accent-bg';
const statusChipIdle = 'bg-surface-card text-text-muted ring-border-soft hover:bg-surface-hover';

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

  const refinements = useMemo(() => {
    const out: Array<{ id: string; label: string; onRemove: () => void }> = [];
    if (expiringSoon) {
      out.push({
        id: 'soon',
        label: `${WARRANTY_EXPIRING_SOON_DAYS} days out`,
        onRemove: () => setExpiringSoon(false),
      });
    }
    if (status) {
      out.push({
        id: 'status',
        label: WARRANTY_STATUS_LABEL[status],
        onRemove: () => setStatus(null),
      });
    }
    return out;
  }, [expiringSoon, setExpiringSoon, setStatus, status]);

  const renderFilters = (onClose: () => void) => (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-text-faint">Expiry</p>
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
        <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-text-faint">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {/* ds-raw-button: segmented status-filter chip (conditional active ring/fill), not a single DS variant */}
          <button
            type="button"
            onClick={() => setStatus(null)}
            className={cn(statusChip, status === null ? statusChipActive : statusChipIdle)}
          >
            All
          </button>
          {WARRANTY_CLAIM_STATUSES.map((s) => (
            // ds-raw-button: segmented status-filter chip (conditional active ring/fill), not a single DS variant
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
      <Button variant="brand" size="lg" onClick={onClose} className="mt-2 w-full">
        Done
      </Button>
    </div>
  );

  const exportHref = `/api/warranty/reports/export${status ? `?status=${status}` : ''}`;

  const actionButtons = (
    <div className="flex items-stretch gap-2 border-t border-border-hairline px-3 py-2">
      <a
        href={exportHref}
        className="inline-flex flex-1 items-center justify-center rounded-md border border-border-soft px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-surface-hover"
      >
        Export
      </a>
      <Button
        variant="primary"
        size="sm"
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => setLogOpen(true)}
        className="flex-1"
      >
        Log Claim
      </Button>
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
      filter={{
        label: 'Filters',
        refinements,
        activeCount: refinements.length,
        onClearAll: () => {
          setStatus(null);
          setExpiringSoon(false);
        },
        renderDropdown: renderFilters,
      }}
      footer={actionButtons}
    >
      {error ? (
        <div className="px-1 py-6 text-sm text-text-danger">
          {error instanceof Error ? error.message : 'Failed to load warranty claims.'}
        </div>
      ) : isLoading ? (
        <div className="px-1 py-6 text-sm text-text-faint">Loading warranty claims…</div>
      ) : claims.length === 0 ? (
        <div className="px-1 py-10 text-center text-sm text-text-faint">
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
                {/* ds-raw-button: multi-line text-left master-detail picker row (title + badge + clock + customer), not a standard action button */}
                <button
                  type="button"
                  onClick={() => openClaim(selected ? null : claim.id)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition',
                    selected
                      ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                      : 'border-border-hairline bg-surface-card hover:border-border-soft hover:bg-surface-hover',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-text-default">{title}</span>
                    <WarrantyStatusBadge status={claim.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-caption text-text-faint">
                      {claim.claimNumber}
                      {claim.serialNumber ? ` · ${claim.serialNumber}` : ''}
                    </span>
                    <WarrantyClockChip daysRemaining={claim.daysRemaining} basis={claim.clockBasis} />
                  </div>
                  {claim.customerName && (
                    <div className="mt-0.5 truncate text-caption text-text-faint">{claim.customerName}</div>
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
