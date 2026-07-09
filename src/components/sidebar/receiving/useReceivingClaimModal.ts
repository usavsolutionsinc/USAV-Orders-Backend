'use client';

/**
 * B2 — claim-modal state machine for filing a Zendesk claim from a receiving row.
 * Owns the open/close state and the success side-effect (toast + data refresh);
 * the component renders the actual `<ReceivingClaimModal>` from `claimRow`. This
 * keeps the triage Unfound list a pure composition — behavior here, markup there.
 */

import { useCallback, useState } from 'react';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { toast } from '@/lib/toast';

export interface ReceivingClaimModalController {
  /** The row whose claim modal is open, or null when closed. */
  claimRow: ReceivingLineRow | null;
  /** Open the claim modal for a row. */
  openClaim: (row: ReceivingLineRow) => void;
  /** Close without filing. */
  closeClaim: () => void;
  /** Modal success handler — toasts, closes, and nudges a data refresh. */
  onTicketCreated: (ticket: string) => void;
}

export function useReceivingClaimModal(): ReceivingClaimModalController {
  const [claimRow, setClaimRow] = useState<ReceivingLineRow | null>(null);

  const openClaim = useCallback((row: ReceivingLineRow) => setClaimRow(row), []);
  const closeClaim = useCallback(() => setClaimRow(null), []);
  const onTicketCreated = useCallback((ticket: string) => {
    toast.success(`Claim filed — ${ticket}`);
    setClaimRow(null);
    // Nudge the rail + dashboard to refetch (the cron resolves the exception
    // once Zoho syncs; the ticket # lands on the carton now).
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  }, []);

  return { claimRow, openClaim, closeClaim, onTicketCreated };
}
