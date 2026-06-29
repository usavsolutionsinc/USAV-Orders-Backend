'use client';

import { useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useWarrantyClaims, useWarrantyUrlState } from '@/hooks/useWarrantyClaims';
import { WarrantyClockChip, WarrantyStatusBadge } from '@/components/warranty/chips';
import { WarrantyTicketButton } from '@/components/warranty/WarrantyTicketPopover';
import { formatDateTimePST } from '@/utils/date';

/**
 * Right-pane warranty claims table. Visual display only — search / status /
 * expiring filters all live in the sidebar (URL params); this reads the same
 * params so it shares one React Query cache key with the sidebar list.
 */
export function WarrantyClaimsTable() {
  const searchParams = useSearchParams();
  const search = String(searchParams.get('search') || '').trim();
  const { status, expiringSoon, openClaimId, openClaim } = useWarrantyUrlState();

  const { data: claims = [], isLoading, error } = useWarrantyClaims({ status, search, expiringSoon });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 p-8 text-sm text-rose-600">
        {error instanceof Error ? error.message : 'Failed to load warranty claims.'}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="min-w-full p-4">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="text-left text-caption font-semibold uppercase tracking-wide text-gray-400">
              <th className="bg-gray-50 px-3 py-2">Claim</th>
              <th className="bg-gray-50 px-3 py-2">Item</th>
              <th className="bg-gray-50 px-3 py-2">Customer</th>
              <th className="bg-gray-50 px-3 py-2">Status</th>
              <th className="bg-gray-50 px-3 py-2">Warranty</th>
              <th className="bg-gray-50 px-3 py-2">Logged</th>
              <th className="bg-gray-50 px-3 py-2" aria-label="Support ticket" />
            </tr>
          </thead>
          <tbody>
            {claims.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-16 text-center text-sm text-gray-400">
                  No warranty claims match the current filters.
                </td>
              </tr>
            ) : (
              claims.map((claim) => {
                const selected = claim.id === openClaimId;
                const title = claim.productTitle || claim.sku || claim.serialNumber || '—';
                return (
                  <tr
                    key={claim.id}
                    onClick={() => openClaim(selected ? null : claim.id)}
                    className={cn(
                      'cursor-pointer transition',
                      selected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50',
                    )}
                  >
                    <td className="border-b border-gray-100 px-3 py-2 align-top">
                      <div className="font-mono text-caption text-gray-500">{claim.claimNumber}</div>
                      {claim.serialNumber && (
                        <div className="font-mono text-caption text-gray-400">{claim.serialNumber}</div>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 align-top">
                      <div className="max-w-[280px] truncate text-gray-900">{title}</div>
                      {claim.sku && claim.productTitle && (
                        <div className="truncate text-caption text-gray-400">{claim.sku}</div>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 align-top text-gray-600">
                      {claim.customerName || '—'}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 align-top">
                      <WarrantyStatusBadge status={claim.status} />
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 align-top">
                      <WarrantyClockChip daysRemaining={claim.daysRemaining} basis={claim.clockBasis} />
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 align-top text-caption text-gray-400">
                      {formatDateTimePST(claim.createdAt)}
                    </td>
                    <td
                      className="border-b border-gray-100 px-2 py-1.5 align-top"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <WarrantyTicketButton claimId={claim.id} linked={claim.zendeskTicketId != null} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
