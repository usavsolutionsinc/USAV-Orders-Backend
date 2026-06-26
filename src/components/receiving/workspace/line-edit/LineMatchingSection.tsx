'use client';

/**
 * LineMatchingSection — the triage "Smart Matching" hub.
 *
 * Rendered inside the SHARED `LineEditPanel` (triage variant, gated by
 * `caps.matching`). In triage the separate PO-items card is removed and its
 * carton actions move here: Open-in-unbox + the add "+" sit top-right, and
 * "Link repair service" is a left tab — all reusing the existing
 * `useUnmatchedItems` controller + `CartonAddPopover` / `EcwidProductSearchPopover`
 * (no new add/link logic).
 *
 * The card pairs the inbound (return) package to REAL signals only — Zendesk
 * claim tickets (search + link) — and shows the current pairing (linked ticket
 * + Ecwid/PO order #, last-4 copy chips) in one "Paired" row. No fabricated
 * confidence score. "New return ticket" reuses the panel's own claim modal.
 */

import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Loader2,
  Mail,
  PackageOpen,
  Plus,
  Search,
  Wrench,
} from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { Button } from '@/design-system/primitives/Button';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { OrderIdChip, TicketChip, getLast4 } from '@/components/ui/CopyChip';
import { CartonAddPopover } from '@/components/receiving/workspace/CartonAddPopover';
import { EcwidProductSearchPopover } from '@/components/receiving/unfound/EcwidProductSearchPopover';
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

export function LineMatchingSection({
  row,
  staffId,
  c,
}: {
  row: ReceivingLineRow;
  staffId: string;
  c: MatchingControllerSlice;
}) {
  const pkg = toTriagePackage(row);

  // No carton record yet → a minimal teaching card (the carton controller needs
  // a real receivingId, so we don't mount it here).
  if (!pkg.receivingId) {
    return (
      <WorkspaceCard label="Smart matching" overflow="visible">
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-500">
          This package has no carton record yet — scan its tracking to enable matching.
        </p>
      </WorkspaceCard>
    );
  }

  return <TriageMatchingCard row={row} staffId={staffId} receivingId={pkg.receivingId} c={c} />;
}

/**
 * Inner card — mounts only with a valid receivingId, so both hooks
 * (`useTriagePanel` for Zendesk matching, `useUnmatchedItems` for the carton
 * add/link actions) run unconditionally and safely.
 */
function TriageMatchingCard({
  row,
  staffId,
  receivingId,
  c,
}: {
  row: ReceivingLineRow;
  staffId: string;
  receivingId: number;
  c: MatchingControllerSlice;
}) {
  const router = useRouter();
  const t = useTriagePanel({ row });
  const { pkg } = t;

  // Reused carton controller — owns the add "+" + repair-service link popovers.
  const u = useUnmatchedItems({
    receivingId,
    staffId,
    sourcePlatformHint: pkg.sourcePlatform ?? undefined,
    receivingTypeHint: (pkg.intakeType?.toUpperCase() as 'PO' | 'RETURN' | 'TRADE_IN') ?? 'PO',
    listingUrlHint: row.receiving_listing_url ?? undefined,
  });

  const showCartonActions = pkg.isUnmatched;

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

  return (
    <WorkspaceCard
      label="Smart matching"
      overflow="visible"
      actions={
        <div className="flex items-center gap-1.5">
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
      {/* Tabs (left): Zendesk tickets is the active content; Link repair service
          launches the Ecwid -RS picker popover. */}
      <div className="mb-3 flex items-center gap-1">
        <span className="rounded-md bg-blue-50 px-2.5 py-1 text-caption font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200">
          Zendesk tickets
        </span>
        {showCartonActions ? (
          <button
            type="button"
            onClick={() => u.setPopoverMode('repair_service')}
            title="Pick a recent Ecwid repair-service order (-RS) to link to this carton"
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-caption font-bold uppercase tracking-wider text-sky-700 hover:bg-sky-50"
          >
            <Wrench className="h-3 w-3" />
            Link repair service
          </button>
        ) : null}
        {t.hiddenLinked > 0 ? (
          <HoverTooltip label={`${t.hiddenLinked} ticket(s) already linked elsewhere are hidden`}>
            <span className="ml-auto text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
              {t.hiddenLinked} hidden
            </span>
          </HoverTooltip>
        ) : null}
      </div>

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

      {/* Candidate list / typed states */}
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

      {/* Reused popovers (centered overlays — JSX position is irrelevant). */}
      {u.addOpen ? (
        <CartonAddPopover
          tabs={['item', 'web', 'box']}
          unitIds={u.cartonUnitIds}
          onAddLine={u.handleAddLine}
          onAssignedBox={u.setAssignedBox}
          onClose={() => u.setAddOpen(false)}
        />
      ) : null}
      {u.popoverMode === 'repair_service' ? (
        <EcwidProductSearchPopover
          receivingId={receivingId}
          popoverMode={u.popoverMode}
          onSelect={u.handleAddLine}
          onClose={() => u.setPopoverMode(null)}
        />
      ) : null}
    </WorkspaceCard>
  );
}
