'use client';

/**
 * usePoSuggestions — the PO-matching auto-suggest tier
 * (docs/receiving-triage-redesign-plan.md §3.6). Extends the already-shipped
 * pairing hub rather than rebuilding it: reuses the EXISTING read-only
 * `/api/receiving/po-search` typeahead (local PO mirror, no Zoho round-trip)
 * and the EXISTING audited `/api/receiving/relink` write — the same two
 * endpoints `PoLinkTab` already calls for the manual search. No fabricated
 * confidence score: a candidate only surfaces when the carton's own tracking
 * digits are actually found inside that PO's `reference_number`, the same
 * substring match `po-search` itself performs server-side.
 *
 * Sits ALONGSIDE `PoLinkTab` (D1) — this is the auto-suggest banner shown
 * above the pairing tabs; the manual Zoho-PO search tab is unchanged.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated } from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

export interface PoSuggestCandidate {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string | null;
  reference_number: string | null;
  vendor_name: string | null;
  status: string | null;
}

/** Mirrors reconcile-unmatched.ts's last8Digits — the same tracking-tail signal. */
function last8Digits(tracking: string | null | undefined): string | null {
  const digits = String(tracking || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

function normalizeRef(ref: string | null | undefined): string {
  return (ref || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function usePoSuggestions(row: ReceivingLineRow, enabled: boolean) {
  const queryClient = useQueryClient();
  const last8 = useMemo(() => last8Digits(row.tracking_number), [row.tracking_number]);
  const isUnmatched = row.receiving_source === 'unmatched';
  const active = enabled && isUnmatched && !!last8;

  const query = useQuery<PoSuggestCandidate[]>({
    queryKey: ['po-suggest', row.receiving_id, last8] as const,
    queryFn: async () => {
      const res = await fetch(`/api/receiving/po-search?q=${encodeURIComponent(last8!)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { candidates?: PoSuggestCandidate[] };
      // Keep only candidates whose reference actually contains the tracking
      // digits — po-search's PO#/vendor-name branches can otherwise surface an
      // unrelated row for a purely numeric query.
      return (data.candidates ?? []).filter((c) => normalizeRef(c.reference_number).includes(last8!));
    },
    enabled: active,
    staleTime: 30_000,
  });

  const [linkingId, setLinkingId] = useState<string | null>(null);
  const accept = async (candidate: PoSuggestCandidate) => {
    if (linkingId || row.receiving_id == null) return;
    setLinkingId(candidate.zoho_purchaseorder_id);
    try {
      const res = await fetch('/api/receiving/relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: row.receiving_id,
          line_id: row.id > 0 ? row.id : undefined,
          zoho_purchaseorder_id: candidate.zoho_purchaseorder_id,
          zoho_purchaseorder_number: candidate.zoho_purchaseorder_number,
          scope: 'both',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        toast.error(body.error || 'Could not link this PO');
        return;
      }
      toast.success(`Linked PO ${candidate.zoho_purchaseorder_number || candidate.zoho_purchaseorder_id}`);
      dispatchLineUpdated({
        id: row.id,
        zoho_purchaseorder_id: candidate.zoho_purchaseorder_id,
        zoho_purchaseorder_number: candidate.zoho_purchaseorder_number,
        receiving_source: 'zoho_po',
      });
      invalidateReceivingFeeds(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not link this PO');
    } finally {
      setLinkingId(null);
    }
  };

  return {
    candidates: query.data ?? [],
    loading: query.isLoading,
    accept,
    linkingId,
  };
}

export type PoSuggestionsController = ReturnType<typeof usePoSuggestions>;
