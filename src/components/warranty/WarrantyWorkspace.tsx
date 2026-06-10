'use client';

import { AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { WarrantyClaimsTable } from '@/components/warranty/WarrantyClaimsTable';
import { WarrantyClaimDetailPanel } from '@/components/warranty/WarrantyClaimDetailPanel';
import { WarrantyCoverageCard } from '@/components/warranty/WarrantyCoverageCard';
import { useWarrantyUrlState } from '@/hooks/useWarrantyClaims';

/**
 * Right-pane workspace for the Orders / Shipping "Warranty Logger" mode:
 * a coverage-lookup card (the "is this order under warranty?" phone-support
 * check) above the claims table + a slide-in detail panel driven by `?open`.
 * Self-contained so the dashboard page only switches one component in.
 */
export function WarrantyWorkspace() {
  const { openClaimId, openClaim } = useWarrantyUrlState();
  const search = String(useSearchParams().get('search') || '').trim();
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WarrantyCoverageCard query={search} />
        <WarrantyClaimsTable />
      </div>
      <AnimatePresence>
        {openClaimId != null && (
          <WarrantyClaimDetailPanel
            key={openClaimId}
            claimId={openClaimId}
            onClose={() => openClaim(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
