'use client';

import { AnimatePresence } from 'framer-motion';
import { WarrantyClaimsTable } from '@/components/warranty/WarrantyClaimsTable';
import { WarrantyClaimDetailPanel } from '@/components/warranty/WarrantyClaimDetailPanel';
import { useWarrantyUrlState } from '@/hooks/useWarrantyClaims';

/**
 * Right-pane workspace for the Orders / Shipping "Warranty Logger" mode:
 * the claims table + a slide-in detail panel driven by `?open`. Self-contained
 * so the dashboard page only switches one component in.
 */
export function WarrantyWorkspace() {
  const { openClaimId, openClaim } = useWarrantyUrlState();
  return (
    <>
      <WarrantyClaimsTable />
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
