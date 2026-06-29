'use client';

/**
 * "Email PO" tab for the Package Pairing surface.
 *
 * Searches the PO-Gmail worklist (`email_missing_purchase_orders`) — purchase-
 * order confirmation emails ingested from Gmail that never got a Zoho match.
 * This closes the core gap: a carton's tracking arrived, but its order was never
 * imported (the seller never gave the buyer tracking), so it's sitting in the PO
 * email inbox. The operator finds the matching email here and links its PO#.
 *
 * Link writes the PO# onto the carton via the existing PATCH /api/receiving/:id
 * ({ zoho_purchaseorder_number }) — which flips the carton off the Unfound queue
 * (same effect as the relink flow) — then marks the email row resolved.
 *
 * Mirrors {@link PoLinkTab}'s shape (search → results → link) so the two PO
 * surfaces feel identical.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Mail } from '@/components/Icons';
import { PairingLinkButton } from './PairingLinkButton';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated } from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface EmailPoCandidate {
  id: string;
  gmail_msg_id: string;
  po_numbers: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
}

export function EmailPoLinkTab({
  row,
  receivingId,
}: {
  row: ReceivingLineRow;
  receivingId: number;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  // Key that's being linked = `${rowId}:${poNumber}` so the spinner targets the
  // exact PO button (an email can list several PO#s).
  const [linkingKey, setLinkingKey] = useState<string | null>(null);

  const trimmed = query.trim();
  const { data, isFetching, isError } = useQuery({
    queryKey: ['email-po-search', trimmed],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/email-po?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error('Email PO search failed');
      return (await res.json()) as { success: boolean; candidates: EmailPoCandidate[] };
    },
    // Always enabled — an empty query lists the most recent locally-stored PO
    // emails (the Gmail-ingested worklist); ≥2 chars filters.
    enabled: true,
    staleTime: 15_000,
  });
  const candidates = data?.candidates ?? [];

  const link = async (emailRow: EmailPoCandidate, poNumber: string) => {
    const key = `${emailRow.id}:${poNumber}`;
    if (linkingKey) return;
    setLinkingKey(key);
    try {
      // 1. Write the PO# onto the carton — flips source → leaves Unfound.
      const res = await fetch(`/api/receiving/${receivingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoho_purchaseorder_number: poNumber }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || body.success === false) {
        toast.error(body.error || `Link failed (${res.status})`);
        return;
      }
      // 2. Self-heal the worklist — mark the email PO resolved (best-effort).
      void fetch('/api/receiving/email-po', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailRow.id }),
      }).catch(() => {});

      toast.success(`Linked PO ${poNumber}`);
      // Update the open carton's displayed PO in place (carton context + feeds).
      dispatchLineUpdated({
        id: row.id,
        zoho_purchaseorder_number: poNumber,
        receiving_source: 'zoho_po',
      });
      invalidateReceivingFeeds(queryClient);
      setQuery('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setLinkingKey(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search the Gmail-ingested PO worklist (PO # / subject / sender). */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PO email by PO # / subject / sender…"
          className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-8 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isFetching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
        ) : null}
      </div>

      {/* Results — the most recent locally-stored PO emails by default; the
          search box filters them. */}
      {isError ? (
        <p className="rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-center text-xs text-rose-600">
          Couldn’t load PO emails. The PO-Gmail inbox may be unconfigured.
        </p>
      ) : isFetching && candidates.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-5 text-xs text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading PO emails…
        </p>
      ) : candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-500">
          {trimmed ? `No pending PO emails match “${trimmed}”.` : 'No pending PO emails in the inbox.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((em) => (
            <div
              key={em.id}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2"
            >
              <div className="flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
                <Mail className="h-3 w-3 shrink-0 text-gray-400" />
                <span className="truncate">{em.email_from || 'Unknown sender'}</span>
              </div>
              {em.email_subject ? (
                // ds-allow-title: truncation-only native title on a clipped, non-interactive <p>
                <p className="mt-0.5 truncate text-caption font-bold text-gray-900" title={em.email_subject}>
                  {em.email_subject}
                </p>
              ) : null}
              {/* One row per PO# the email referenced: PO# (left) + the shared
                  Link action (right) — same component the other pairing tabs use. */}
              <div className="mt-1.5 space-y-1">
                {em.po_numbers.length === 0 ? (
                  <span className="text-xs text-gray-400">No PO number parsed from this email.</span>
                ) : (
                  em.po_numbers.map((po) => {
                    const key = `${em.id}:${po}`;
                    const isLinking = linkingKey === key;
                    return (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-caption font-bold text-gray-900">
                          {po}
                        </span>
                        <PairingLinkButton
                          loading={isLinking}
                          disabled={linkingKey !== null}
                          onClick={() => void link(em, po)}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
