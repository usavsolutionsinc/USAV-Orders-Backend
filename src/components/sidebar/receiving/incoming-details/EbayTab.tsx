'use client';

/**
 * eBay tab for the IncomingDetailsPanel (Universal Incoming, plan §7.3).
 *
 * Read-only marketplace identity for a non-Zoho Incoming row — the eBay order#,
 * buyer account, seller, status, payment, listing — plus the bidirectional
 * **Link to Zoho PO** affordance: search the local PO mirror and MERGE the chosen
 * Zoho PO onto this spine row via POST /api/receiving/inbound/link (the same
 * chokepoint the row's Link tab uses). Once a Zoho link exists the panel's "PO"
 * tab renders the accounting side; here it shows as linked.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Check, ExternalLink } from '@/components/Icons';
import { OrderIdChip, PoChip, getLast4 } from '@/components/ui/CopyChip';
import { PairingLinkButton, PairingLinkedBadge } from '@/components/receiving/workspace/line-edit/PairingLinkButton';
import { toast } from '@/lib/toast';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import type { DetailsResponse } from './incoming-details-shared';

interface PoCandidate {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string | null;
  reference_number: string | null;
  vendor_name: string | null;
  status: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-black uppercase tracking-widest text-text-soft">{label}</p>
      <div className="text-caption font-semibold text-text-default">{children}</div>
    </div>
  );
}

export function EbayTab({ data }: { data: DetailsResponse }) {
  const inbound = data.inbound;
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const zohoLink = inbound?.links.find((l) => l.source_type === 'zoho') ?? null;
  const zohoLinked = Boolean(zohoLink) || Boolean(inbound?.zoho_purchaseorder_id);

  const trimmed = query.trim();
  const { data: search, isFetching, isError } = useQuery({
    queryKey: ['po-search', trimmed],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/po-search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error('PO search failed');
      return (await res.json()) as { success: boolean; candidates: PoCandidate[] };
    },
    enabled: !zohoLinked, // no search once linked
    staleTime: 15_000,
  });
  const candidates = search?.candidates ?? [];

  if (!inbound) {
    return <p className="py-6 text-center text-caption text-text-soft">No marketplace details.</p>;
  }

  const merge = async (po: PoCandidate) => {
    if (linkingId) return;
    setLinkingId(po.zoho_purchaseorder_id);
    const poLabel = po.zoho_purchaseorder_number || po.zoho_purchaseorder_id;
    try {
      const res = await fetch('/api/receiving/inbound/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_line_id: inbound.receiving_line_id,
          target: {
            system: 'zoho',
            purchase_order_id: po.zoho_purchaseorder_id,
            purchase_order_number: po.zoho_purchaseorder_number,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; merged?: boolean };
      if (!res.ok || !body.success) {
        toast.error(body.error || `Link failed (${res.status})`);
        return;
      }
      toast.success(body.merged ? `Merged into PO ${poLabel}` : `Linked PO ${poLabel}`);
      queryClient.invalidateQueries({ queryKey: ['incoming-details'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
      invalidateReceivingFeeds(queryClient);
      setQuery('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setLinkingId(null);
    }
  };

  const sourceLabel = inbound.source_type === 'ebay' ? 'eBay' : inbound.source_type;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="grid grid-cols-2 gap-4">
        <Field label={`${sourceLabel} order`}>
          <OrderIdChip value={inbound.source_order_id} display={inbound.order_number || getLast4(inbound.source_order_id)} />
        </Field>
        <Field label="Account">{inbound.account_label || '—'}</Field>
        <Field label="Seller">{inbound.seller_name || '—'}</Field>
        <Field label="Status">{inbound.status || '—'}</Field>
        <Field label="Payment">{inbound.payment_status || '—'}</Field>
        {inbound.listing_url ? (
          <Field label="Listing">
            <a
              href={inbound.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          </Field>
        ) : null}
      </div>

      {/* Link to Zoho PO — the merge affordance. */}
      <div className="space-y-2 border-t border-border-soft pt-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-text-soft">Zoho purchase order</p>
        {zohoLinked ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            {inbound.zoho_purchaseorder_id ? (
              <PoChip value={inbound.zoho_purchaseorder_id} display={getLast4(inbound.zoho_purchaseorder_id)} />
            ) : null}
            <span className="text-caption font-semibold text-emerald-700">Linked</span>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search PO # / reference / vendor…"
                className="w-full rounded-lg border border-border-soft py-2 pl-8 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {isFetching ? (
                <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-faint" />
              ) : null}
            </div>
            {isError ? (
              <p className="rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-4 text-center text-xs text-rose-600">
                Couldn’t load purchase orders.
              </p>
            ) : candidates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-4 py-4 text-center text-xs text-text-soft">
                {trimmed ? `No purchase orders match “${trimmed}”.` : 'Search to link this order to its Zoho PO.'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {candidates.map((po) => (
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
                      </p>
                    </div>
                    <PairingLinkButton
                      loading={linkingId === po.zoho_purchaseorder_id}
                      disabled={linkingId !== null}
                      onClick={() => void merge(po)}
                      label="Merge"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
