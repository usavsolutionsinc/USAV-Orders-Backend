'use client';

/**
 * LineMatchingSection — the "Package Pairing" hub.
 *
 * Rendered inside the SHARED `LineEditPanel`: in triage (gated by
 * `caps.matching`), and in unbox for UNFOUND cartons. In triage the separate
 * PO-items card is removed and its carton actions move here: Open-in-unbox + the
 * add "+" sit top-right. In unbox the Open-in-unbox jump is hidden (already
 * there) via `showOpenInUnbox`.
 *
 * The body is a switchable tab list (same `HorizontalButtonSlider` the
 * Notes/Checklist card uses):
 *   • Zendesk tickets      — search + link a real customer claim ticket
 *   • Link repair service  — an INLINE list of recent Ecwid orders (reusing the
 *                            Ecwid search hook + list), relaxed to include normal
 *                            orders too, not just -RS SKUs.
 *
 * Pairing uses REAL signals only (no fabricated score); the "Paired" row shows
 * the linked ticket + Ecwid/PO order # (last-4 copy chips). "New return ticket"
 * reuses the panel's own claim modal.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Loader2,
  Mail,
  PackageOpen,
  Plus,
  Search,
  Wrench,
  ZendeskMark,
} from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { Button } from '@/design-system/primitives/Button';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { OrderIdChip, TicketChip, getLast4 } from '@/components/ui/CopyChip';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { CartonAddPopover } from '@/components/receiving/workspace/CartonAddPopover';
import { useEcwidProductSearch } from '@/components/receiving/unfound/ecwid-search/useEcwidProductSearch';
import { EcwidSearchInputs } from '@/components/receiving/unfound/ecwid-search/EcwidSearchInputs';
import { EcwidResultsList } from '@/components/receiving/unfound/ecwid-search/EcwidResultsList';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { MatchCard } from '@/components/receiving/triage/MatchCard';
import { relativeTime, toTriagePackage } from '@/components/receiving/triage/triage-types';
import { useTriagePanel } from '@/components/receiving/triage/useTriagePanel';
import { useUnmatchedItems } from '@/components/receiving/workspace/unmatched-items/useUnmatchedItems';

/** Minimal controller slice this section needs to open the shared claim modal. */
interface MatchingControllerSlice {
  setClaimModalOpen: (open: boolean) => void;
  setReturnClaimPrefill: (value: string | null) => void;
}

type MatchTab = 'zendesk' | 'repair';

export function LineMatchingSection({
  row,
  staffId,
  c,
  showOpenInUnbox = true,
}: {
  row: ReceivingLineRow;
  staffId: string;
  c: MatchingControllerSlice;
  /** Hide the "Open in unbox" jump when already in unbox (self-referential). */
  showOpenInUnbox?: boolean;
}) {
  const pkg = toTriagePackage(row);

  // No carton record yet → a minimal teaching card (the carton controller needs
  // a real receivingId, so we don't mount it here).
  if (!pkg.receivingId) {
    return (
      <WorkspaceCard label="Package Pairing" overflow="visible">
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-500">
          This package has no carton record yet — scan its tracking to enable pairing.
        </p>
      </WorkspaceCard>
    );
  }

  return (
    <TriageMatchingCard
      row={row}
      staffId={staffId}
      receivingId={pkg.receivingId}
      c={c}
      showOpenInUnbox={showOpenInUnbox}
    />
  );
}

/**
 * Inner card — mounts only with a valid receivingId, so all three hooks
 * (`useTriagePanel`, `useUnmatchedItems`, `useEcwidProductSearch`) run
 * unconditionally and safely.
 */
function TriageMatchingCard({
  row,
  staffId,
  receivingId,
  c,
  showOpenInUnbox,
}: {
  row: ReceivingLineRow;
  staffId: string;
  receivingId: number;
  c: MatchingControllerSlice;
  showOpenInUnbox: boolean;
}) {
  const router = useRouter();
  const t = useTriagePanel({ row });
  const { pkg } = t;
  const [tab, setTab] = useState<MatchTab>('zendesk');

  // Reused carton controller — owns the add "+" popover + the add-line path the
  // inline repair list selects into.
  const u = useUnmatchedItems({
    receivingId,
    staffId,
    sourcePlatformHint: pkg.sourcePlatform ?? undefined,
    receivingTypeHint: (pkg.intakeType?.toUpperCase() as 'PO' | 'RETURN' | 'TRADE_IN') ?? 'PO',
    listingUrlHint: row.receiving_listing_url ?? undefined,
  });

  const showCartonActions = pkg.isUnmatched;

  // Reused Ecwid search — drives the INLINE "Link repair service" list. Only
  // loads when the repair tab is active (popoverMode gates the fetch); relaxed
  // to include normal orders, not just -RS SKUs.
  const ec = useEcwidProductSearch({
    receivingId,
    popoverMode: showCartonActions && tab === 'repair' ? 'repair_service' : 'search',
    relaxRepairToAllOrders: true,
    onSelect: u.handleAddLine,
    onClose: () => setTab('zendesk'),
  });

  const openNewReturnTicket = () => {
    c.setReturnClaimPrefill(
      pkg.tracking ? `Return received · tracking ${pkg.tracking}` : null,
    );
    c.setClaimModalOpen(true);
  };

  const openInUnbox = () => {
    const params = new URLSearchParams({ recvId: String(receivingId) });
    if (row.id > 0) params.set('lineId', String(row.id));
    router.push(`/receiving?${params.toString()}`);
  };

  const pairedTicket = pkg.zendeskTicket?.trim() || null;
  const pairedOrder = pkg.poNumber?.trim() || null;

  const tabs: HorizontalSliderItem[] = [
    { id: 'zendesk', label: 'Zendesk tickets', icon: ZendeskMark },
    { id: 'repair', label: 'Link repair service', icon: Wrench },
  ];

  return (
    <WorkspaceCard
      label="Package Pairing"
      overflow="visible"
      actions={
        <div className="flex items-center gap-1.5">
          {showOpenInUnbox ? (
            <HoverTooltip label="Open this carton in unbox (serials, photos, receive)" focusable={false}>
              <button
                type="button"
                onClick={openInUnbox}
                className="flex h-6 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-caption font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100"
              >
                <PackageOpen className="h-3 w-3" />
                Open in unbox
              </button>
            </HoverTooltip>
          ) : null}
          {showCartonActions ? (
            <HoverTooltip label="Add to carton — catalog item, web search, or a box" focusable={false}>
              <button
                type="button"
                onClick={() => u.setAddOpen(true)}
                aria-label="Add to carton"
                className="flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
              </button>
            </HoverTooltip>
          ) : null}
        </div>
      }
    >
      {/* Switchable tabs (same control as the Notes/Checklist card). Only when
          there's a carton to link repair-service orders against. */}
      {showCartonActions ? (
        <div className="mb-3 flex items-center gap-2">
          <HorizontalButtonSlider
            variant="nav"
            dense
            overlay
            items={tabs}
            value={tab}
            onChange={(id) => setTab(id as MatchTab)}
            aria-label="Matching tabs"
          />
          {tab === 'zendesk' && t.hiddenLinked > 0 ? (
            <HoverTooltip label={`${t.hiddenLinked} ticket(s) already linked elsewhere are hidden`}>
              <span className="ml-auto shrink-0 text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
                {t.hiddenLinked} hidden
              </span>
            </HoverTooltip>
          ) : null}
        </div>
      ) : null}

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      {showCartonActions && tab === 'repair' ? (
        // Inline repair-service order list — reuses the Ecwid search inputs +
        // results list (relaxed to include normal orders, not just -RS).
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <EcwidSearchInputs c={ec} />
          <EcwidResultsList c={ec} />
        </div>
      ) : (
        <ZendeskMatchTab t={t} />
      )}

      {/* Paired summary — what this carton is currently paired to (last-4 chips). */}
      {pairedTicket || pairedOrder ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
          <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">Paired</span>
          {pairedTicket ? (
            <TicketChip value={pairedTicket.replace(/^#/, '')} display={pairedTicket} />
          ) : null}
          {pairedTicket && pairedOrder ? <span className="text-gray-300">·</span> : null}
          {pairedOrder ? (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              Order
              <OrderIdChip value={pairedOrder} display={getLast4(pairedOrder)} dense />
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Actions — file a new return ticket (reuses the panel claim modal) +
          flag for manual review (unmatched cartons only). */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={openNewReturnTicket}
        >
          New return ticket
        </Button>
        {t.canMarkReview ? (
          <Button
            variant="ghost"
            size="sm"
            icon={
              t.markingReview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )
            }
            onClick={() => t.markManualReview()}
            disabled={t.markingReview}
          >
            Manual review
          </Button>
        ) : null}
      </div>

      {/* Add-to-carton popover ("+"). The repair-service picker is now inline
          (the tab above), so only this modal remains. */}
      {u.addOpen ? (
        <CartonAddPopover
          tabs={['item', 'web', 'box']}
          unitIds={u.cartonUnitIds}
          onAddLine={u.handleAddLine}
          onAssignedBox={u.setAssignedBox}
          onClose={() => u.setAddOpen(false)}
        />
      ) : null}
    </WorkspaceCard>
  );
}

/** The Zendesk-tickets tab body — search + candidate match cards + delivery hints. */
function ZendeskMatchTab({ t }: { t: ReturnType<typeof useTriagePanel> }) {
  return (
    <>
      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={t.matchQuery}
          onChange={(e) => t.setMatchQuery(e.target.value)}
          placeholder="Search claim tickets by #, order, email, customer…"
          className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-8 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {t.candidatesFetching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
        ) : null}
      </div>

      {t.candidatesLoading ? (
        <p className="flex items-center justify-center gap-2 py-5 text-xs text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading matches…
        </p>
      ) : t.candidatesError ? (
        <p className="rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-center text-xs text-rose-600">
          Couldn’t load Zendesk matches. Zendesk may be unconfigured — you can still file a new
          ticket below.
        </p>
      ) : t.candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-500">
          {t.matchQuery.trim()
            ? `No tickets match “${t.matchQuery.trim()}”.`
            : 'No recent claim tickets. Search by order #, email, or file a new return ticket.'}
        </p>
      ) : (
        <div className="space-y-2">
          {t.candidates.map((candidate) => (
            <MatchCard
              key={candidate.id}
              candidate={candidate}
              onLink={t.linkTicket}
              linking={t.linkingId === candidate.id}
              anyLinking={t.linkingId !== null}
            />
          ))}
        </div>
      )}

      {/* eBay delivered-email corroboration (real signal; order # via copy chip · last 4) */}
      {t.deliveredEmails.length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="mb-1.5 text-eyebrow font-black uppercase tracking-widest text-gray-400">
            Marketplace delivery signals
          </p>
          <div className="space-y-1">
            {t.deliveredEmails.map((sig, i) => (
              <div
                key={`${sig.orderNumber}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-violet-50/60 px-2.5 py-1.5"
              >
                <Mail className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-gray-600">
                  Order
                  <OrderIdChip value={sig.orderNumber} display={getLast4(sig.orderNumber)} dense />
                  {sig.deliveredAt ? (
                    <span className="truncate text-gray-400">· delivered {relativeTime(sig.deliveredAt)}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
