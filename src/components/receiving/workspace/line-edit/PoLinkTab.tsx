'use client';

/**
 * "Link a PO" tab for the Package Pairing surface.
 *
 * Makes the WEBSITE the source of truth for the carton↔PO link: search the local
 * PO mirror (read-only, no Zoho round-trip) and re-point this carton + line at
 * the correct PO — even when Zoho already had a different (wrong) one. Posts to
 * the audited /api/receiving/relink (scope 'both'); the displayed PO# updates in
 * place via `dispatchLineUpdated`.
 *
 * This replaces "Zoho is authoritative": an operator who knows the right PO can
 * correct a mis-linked carton here instead of editing Zoho and waiting for a sync.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from '@/components/Icons';
import { PairingLinkButton, PairingLinkedBadge } from './PairingLinkButton';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated } from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface PoCandidate {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string | null;
  reference_number: string | null;
  vendor_name: string | null;
  status: string | null;
}

export function PoLinkTab({
  row,
  receivingId,
}: {
  row: ReceivingLineRow;
  receivingId: number;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const currentPoNumber = (row.zoho_purchaseorder_number || '').trim() || null;
  const currentPoId = (row.zoho_purchaseorder_id || '').trim() || null;

  const trimmed = query.trim();
  const { data, isFetching, isError } = useQuery({
    queryKey: ['po-search', trimmed],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/po-search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error('PO search failed');
      return (await res.json()) as { success: boolean; candidates: PoCandidate[] };
    },
    // Always enabled — an empty query lists the most recent locally-stored
    // incoming POs; ≥2 chars filters the mirror.
    enabled: true,
    staleTime: 15_000,
  });
  const candidates = data?.candidates ?? [];

  const link = async (po: PoCandidate) => {
    if (linkingId) return;
    setLinkingId(po.zoho_purchaseorder_id);
    try {
      const res = await fetch('/api/receiving/relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: receivingId,
          line_id: row.id > 0 ? row.id : undefined,
          zoho_purchaseorder_id: po.zoho_purchaseorder_id,
          zoho_purchaseorder_number: po.zoho_purchaseorder_number,
          scope: 'both',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        toast.error(body.error || `Link failed (${res.status})`);
        return;
      }
      toast.success(`Linked PO ${po.zoho_purchaseorder_number || po.zoho_purchaseorder_id}`);
      // Update the open carton's displayed PO in place (carton context + feeds).
      dispatchLineUpdated({
        id: row.id,
        zoho_purchaseorder_id: po.zoho_purchaseorder_id,
        zoho_purchaseorder_number: po.zoho_purchaseorder_number,
        receiving_source: 'zoho_po',
      });
      invalidateReceivingFeeds(queryClient);
      setQuery('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* The currently-linked PO is shown in the global header — not repeated
          here. This tab is purely the search-and-(re)link surface. */}

      {/* Search the local PO mirror (PO# / reference / vendor). */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PO # / reference / vendor…"
          className="w-full rounded-lg border border-border-soft py-2 pl-8 pr-8 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isFetching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-faint" />
        ) : null}
      </div>

      {/* Results — the most recent locally-stored incoming POs by default; the
          search box filters them. */}
      {isError ? (
        <p className="rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-center text-xs text-rose-600">
          Couldn’t load purchase orders. Try again.
        </p>
      ) : isFetching && candidates.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-5 text-xs text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading purchase orders…
        </p>
      ) : candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-4 py-5 text-center text-xs text-text-soft">
          {trimmed ? `No purchase orders match “${trimmed}”.` : 'No incoming purchase orders stored yet.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((po) => {
            const isCurrent = currentPoId != null && po.zoho_purchaseorder_id === currentPoId;
            const isLinking = linkingId === po.zoho_purchaseorder_id;
            return (
              <div
                key={po.zoho_purchaseorder_id}
                className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface-card px-3 py-2 hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption font-bold text-text-default">
                    {po.zoho_purchaseorder_number || `PO ${po.zoho_purchaseorder_id}`}
                  </p>
                  <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                    {po.vendor_name || 'Unknown vendor'}
                    {po.reference_number ? ` · ref ${po.reference_number}` : ''}
                    {po.status ? ` · ${po.status}` : ''}
                  </p>
                </div>
                {isCurrent ? (
                  <PairingLinkedBadge />
                ) : (
                  <PairingLinkButton
                    loading={isLinking}
                    disabled={linkingId !== null}
                    onClick={() => void link(po)}
                    label={currentPoNumber ? 'Relink' : 'Link'}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
