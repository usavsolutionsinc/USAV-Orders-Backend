'use client';

/**
 * LineMatchingSection — the "Package Pairing" hub.
 *
 * Rendered by `POUnboxingSection` in both panels: always in `TriagePanel`, and
 * in `LineEditPanel` (unbox) for UNFOUND cartons. In triage the separate
 * PO-items card is removed and its carton actions move here: Open-in-unbox + the
 * add "+" sit top-right. In unbox the Open-in-unbox jump is hidden (already
 * there) via `showOpenInUnbox`.
 *
 * The body is a switchable tab list (same `HorizontalButtonSlider` the
 * Notes/Checklist card uses):
 *   • Zendesk tickets          — search + link a real customer claim ticket
 *   • Repair Service / Trade in — an INLINE list of recent Ecwid orders (reusing
 *                            the Ecwid search hook + list), relaxed to include
 *                            normal orders (returns/trade-ins) too, not just -RS.
 *
 * Pairing uses REAL signals only (no fabricated score); the "Paired" row shows
 * the linked ticket + Ecwid/PO order # (last-4 copy chips).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { openInUnboxHref, TRIAGE_SURFACE_ROUTE } from '@/lib/receiving/surface-path';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import {
  Link2,
  Loader2,
  Mail,
  PackageOpen,
  Pencil,
  Search,
  ShoppingCart,
  Unlink,
  ZendeskMark,
} from '@/components/Icons';
import {
  dispatchLineUpdated,
  dispatchSelectLine,
} from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { WorkspaceCard } from '@/design-system/components';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
import { OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { EcwidProductSearchInline } from '@/components/receiving/unfound/EcwidProductSearchInline';
import { ZohoItemPairTab } from '@/components/receiving/workspace/line-edit/ZohoItemPairTab';
import { EmailPoLinkTab } from '@/components/receiving/workspace/line-edit/EmailPoLinkTab';
import { PoLinkTab } from '@/components/receiving/workspace/line-edit/PoLinkTab';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { MatchCard } from '@/components/receiving/triage/MatchCard';
import { relativeTime, toTriagePackage } from '@/components/receiving/triage/triage-types';
import { useTriagePanel } from '@/components/receiving/triage/useTriagePanel';
import { usePoSuggestions } from '@/components/receiving/triage/usePoSuggestions';
import { PoSuggestBanner } from '@/components/receiving/triage/PoSuggestBanner';
import { useUnmatchedItems } from '@/components/receiving/workspace/unmatched-items/useUnmatchedItems';
import { useReceivingCartonUnlink } from '@/components/receiving/workspace/unmatched-items/useReceivingCartonUnlink';
import { isReturnIntake } from '@/lib/receiving/triage-intake-kind';
import { WorkspaceSectionTitle } from '../WorkspaceSectionLabel';

type MatchTab = 'zoho_item' | 'zoho_po' | 'ecwid' | 'email' | 'zendesk';

export function LineMatchingSection({
  row,
  staffId,
  showOpenInUnbox = true,
  embedded = false,
  collapsed = false,
  showTopRule = false,
}: {
  row: ReceivingLineRow;
  staffId: string;
  /** Hide the "Open in unbox" jump when already in unbox (self-referential). */
  showOpenInUnbox?: boolean;
  /**
   * Render bare (no own WorkspaceCard chrome, no own pencil) — used when this
   * section is composed *inside* the unified {@link POUnboxingSection} wrapper,
   * which supplies the single shared card + edit pencil. Defaults to the
   * standalone card so existing callers are unaffected.
   */
  embedded?: boolean;
  /**
   * Embedded-only: collapse the WHOLE section (title + tabs + body) away.
   * Driven by the wrapper's grey pencil. Ignored when not embedded.
   */
  collapsed?: boolean;
  /**
   * Embedded-only: draw a top divider above the section (when a PO-items block
   * sits above it in the wrapper). Animates in/out with the collapse.
   */
  showTopRule?: boolean;
}) {
  const pkg = toTriagePackage(row);

  // No carton record yet → a minimal teaching card (the carton controller needs
  // a real receivingId, so we don't mount it here).
  if (!pkg.receivingId) {
    const teaching = (
      <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-4 py-5 text-center text-xs text-text-soft">
        This package has no carton record yet — scan its tracking to enable pairing.
      </p>
    );
    if (embedded) {
      return (
        <div className="space-y-2">
          <h3 className="text-caption font-bold uppercase tracking-[0.14em] text-text-soft">
            Package Pairing
          </h3>
          {teaching}
        </div>
      );
    }
    return (
      <WorkspaceCard label="Package Pairing" overflow="visible">
        {teaching}
      </WorkspaceCard>
    );
  }

  return (
    <TriageMatchingCard
      row={row}
      staffId={staffId}
      receivingId={pkg.receivingId}
      showOpenInUnbox={showOpenInUnbox}
      embedded={embedded}
      collapsed={collapsed}
      showTopRule={showTopRule}
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
  showOpenInUnbox,
  embedded,
  collapsed,
  showTopRule,
}: {
  row: ReceivingLineRow;
  staffId: string;
  receivingId: number;
  showOpenInUnbox: boolean;
  embedded: boolean;
  collapsed: boolean;
  showTopRule: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const pkg = toTriagePackage(row);
  // 'ecwid' (Ecwid Search) is the default — the recent-orders search (by order #,
  // title, or SKU) is the primary add/pair surface; Link-a-Zoho-PO / Zendesk /
  // Email-PO sit alongside it.
  //
  // Unfound cartons default to the Zoho Item tab (leftmost pill), where the next
  // correct action is to record the product by Zoho SKU even before the PO is
  // known. This is only the initial default (a lazy initializer that runs once)
  // — the operator can still switch to Ecwid / Tickets / Email PO.
  const [tab, setTab] = useState<MatchTab>(() =>
    pkg.isUnmatched ? 'zoho_item' : 'ecwid',
  );

  // A carton can carry TWO independent linkages, set from ANY of the pairing
  // tabs and each individually reversible:
  //   • an ORDER / PO  (Ecwid pairing · Zoho PO relink · Email PO) → pkg.poNumber
  //   • a Zendesk TICKET (the returns claim match)                → pkg.zendeskTicket
  // An order/PO link collapses the picker to the linked summary (the pairing job
  // is done); a ticket-only link keeps the picker open (the operator still needs
  // to pair the order) but surfaces the ticket linkage above it. Either way both
  // linkages render with their own Unlink.
  const orderLinked = !pkg.isUnmatched && Boolean(pkg.poNumber || pkg.zohoPoId);
  const hasTicket = Boolean(pkg.zendeskTicket);
  const [forcePicker, setForcePicker] = useState(false);
  const [unlinkingTicket, setUnlinkingTicket] = useState(false);
  const { unlinkCarton, unlinking } = useReceivingCartonUnlink();
  // Picker is hidden only when an order/PO is linked and the operator hasn't
  // re-opened it to change/add.
  const pickerCollapsed = orderLinked && !forcePicker;
  const zendeskQueriesActive = !collapsed && !pickerCollapsed && tab === 'zendesk';
  const t = useTriagePanel({
    row,
    loadCandidates: zendeskQueriesActive,
    loadDeliveredEmails: zendeskQueriesActive,
  });
  // PO-matching auto-suggest (§3.6) — only worth checking while the picker is
  // actually open for an unmatched carton (not collapsed to the linked summary).
  const poSuggestions = usePoSuggestions(row, !collapsed && !pickerCollapsed);
  const pairingCollapse = useMotionPresence(framerPresence.collapseHeight);
  const pairingCollapseTransition = useMotionTransition(framerTransition.sidebarExpand);

  // Unlink the ORDER/PO — full revert to Unfound (clears the carton + line
  // linkage; leaves any Zendesk ticket intact). Patches the open row so the
  // header chips re-derive immediately, then invalidates the rails/feeds.
  const unlink = async () => {
    const ok = await unlinkCarton({
      receivingId,
      lineId: row.id,
      confirmMessage:
        pkg.isUnmatched || isReturnIntake(row)
          ? 'Unlink this package? The order pairing is cleared and the carton goes back to the Unfound queue.'
          : 'Unlink this package? The PO#/platform pairing is cleared and the carton goes back to the Unfound queue.',
      onSuccess: () => {
        setForcePicker(false);
        if (showOpenInUnbox) {
          // Carton went back to the Unfound queue — a triage sub-view; navigate
          // to the Triage surface's unfound tab.
          const params = new URLSearchParams(searchParams.toString());
          params.delete('mode');
          params.set('triview', 'unfound');
          router.replace(`${TRIAGE_SURFACE_ROUTE}?${params.toString()}`);
        }
      },
    });
    if (ok) setForcePicker(false);
  };

  // Unlink the Zendesk TICKET (carton-grained, matching how the Zendesk tab
  // links it). Uses the shared zendesk-claim/link DELETE; leaves any order/PO
  // pairing intact.
  const unlinkTicket = async () => {
    if (unlinkingTicket) return;
    const ticketId = (pkg.zendeskTicket?.match(/(\d+)/) ?? [])[1];
    if (!ticketId) {
      toast.error('Could not resolve the ticket number');
      return;
    }
    if (!window.confirm(`Unlink Zendesk ticket #${ticketId} from this package?`)) return;
    setUnlinkingTicket(true);
    try {
      const sp = new URLSearchParams({ receivingId: String(receivingId), ticketId });
      const res = await fetch(`/api/receiving/zendesk-claim/link?${sp.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        toast.error(data?.error ?? `Ticket unlink failed (${res.status})`);
        return;
      }
      dispatchLineUpdated({ id: row.id, zendesk_ticket: null });
      await queryClient.invalidateQueries({
        queryKey: ['triage-ticket-candidates', receivingId],
      });
      invalidateReceivingFeeds(queryClient);
      toast.success('Ticket unlinked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ticket unlink failed');
    } finally {
      setUnlinkingTicket(false);
    }
  };

  // The old standalone "+" add popovers (PO-items accordion, unfound items card)
  // are gone — their pencil buttons now dispatch this to open the Ecwid Search
  // tab here, the single add surface. (Same-pane sibling → window event is the
  // simplest bus.) Scroll this card into view since the trigger may sit in
  // another card below.
  const cardTopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const open = () => {
      setTab('ecwid');
      // A linked carton shows the compact summary; force the picker back so the
      // add/pair surface is reachable for an already-paired box.
      setForcePicker(true);
      requestAnimationFrame(() =>
        cardTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    };
    window.addEventListener('receiving-open-pairing-add', open);
    return () => window.removeEventListener('receiving-open-pairing-add', open);
  }, []);

  // Collapse back to the linked summary whenever the carton's representative
  // order/PO changes (a fresh pairing from any tab, or switching to another
  // already-linked carton). Resetting to false = "show summary when linked".
  useEffect(() => {
    setForcePicker(false);
  }, [pkg.poNumber, pkg.zohoPoId]);

  // Reused carton controller — owns the add "+" popover + the add-line path the
  // inline repair list selects into.
  const u = useUnmatchedItems({
    receivingId,
    staffId,
    sourcePlatformHint: pkg.sourcePlatform ?? undefined,
    receivingTypeHint: (pkg.intakeType?.toUpperCase() as 'PO' | 'RETURN' | 'TRADE_IN') ?? 'PO',
    listingUrlHint: row.receiving_listing_url ?? undefined,
    // Update the open panel IMMEDIATELY from the server's returned row — the
    // mutation already hands back the carton + the new line, so we don't refetch
    // to reflect them. invalidateReceivingFeeds is the reconcile, not the path to
    // first paint.
    onLinked: ({ carton, line }) => {
      const cartonPatch = {
        zoho_purchaseorder_number: carton.zoho_purchaseorder_number,
        receiving_source: carton.source ?? 'unmatched',
        source_platform: carton.source_platform ?? null,
        source_platform_pill: carton.source_platform ?? null,
      };
      // Unfound stub (synthetic negative id, no real line): the new line IS the
      // carton's content, so re-select it — the detail pane upgrades from
      // "Unfound PO" → the real item (title/SKU/qty/listing) in one paint.
      if (line && line.id > 0 && row.id < 0) {
        const realRow: ReceivingLineRow = {
          ...row,
          ...cartonPatch,
          id: line.id,
          sku: line.sku ?? row.sku,
          item_name: line.item_name ?? row.item_name,
          quantity_expected: line.quantity_expected,
          quantity_received: line.quantity_received,
          condition_grade: line.condition_grade ?? row.condition_grade,
          receiving_listing_url: line.listing_url ?? row.receiving_listing_url,
          source_platform_pill: line.source_platform_pill ?? cartonPatch.source_platform_pill,
        };
        dispatchSelectLine(realRow);
      } else {
        // Already a real line (e.g. an off-PO add to a matched carton): patch the
        // selected row in place; the new line shows in the accordion on reconcile.
        dispatchLineUpdated({ id: row.id, ...cartonPatch });
      }
      invalidateReceivingFeeds(queryClient);
      setForcePicker(false);
      if (showOpenInUnbox) {
        setTimeout(() => window.dispatchEvent(new CustomEvent('receiving-focus-scan')), 60);
      }
    },
  });

  const openInUnbox = () => {
    router.push(openInUnboxHref(receivingId, row.id));
  };

  const tabs: HorizontalSliderItem[] = [
    // Zoho Item (left pill) — search & add by Zoho SKU (no PO link required).
    { id: 'zoho_item', label: 'Zoho Item', icon: Search },
    // Zoho PO pairing (second pill) — link/relink the carton to a PO.
    { id: 'zoho_po', label: 'Zoho PO', icon: Link2 },
    // Ecwid Search — search ALL recent orders by order #, title, or SKU
    // (relaxed to include normal orders + returns/trade-ins, not just -RS).
    { id: 'ecwid', label: 'Ecwid', icon: ShoppingCart },
    { id: 'zendesk', label: 'Tickets', icon: ZendeskMark },
    // Email PO — search the Gmail-ingested PO worklist (purchase-order emails with
    // no Zoho match) and link the carton to its order. Works for any carton.
    { id: 'email', label: 'Email PO', icon: Mail },
  ];

  // Header actions are shared between the standalone card and the embedded form.
  // The edit pencil is dropped when embedded — the wrapper supplies the single
  // shared pencil (which dispatches `receiving-open-pairing-add` → Items tab).
  const headerActions = (
    <div className="flex shrink-0 items-center gap-1.5">
      {showOpenInUnbox ? (
        <HoverTooltip label="Open this carton in unbox (serials, photos, receive)" asChild focusable={false}>
          <Button
            variant="secondary"
            size="sm"
            icon={<PackageOpen />}
            onClick={openInUnbox}
            className="h-7 border-blue-200 bg-blue-50 px-2.5 text-blue-700 hover:bg-blue-100"
          >
            Open in unbox
          </Button>
        </HoverTooltip>
      ) : null}
      {!embedded ? (
        <HoverTooltip label="Add items — search recent Ecwid orders by order #, title, or SKU" focusable={false}>
          <IconButton
            icon={<Pencil className="h-3.5 w-3.5 text-white" />}
            ariaLabel="Search Ecwid orders to add items"
            onClick={() => {
              setTab('ecwid');
              setForcePicker(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700"
          />
        </HoverTooltip>
      ) : null}
    </div>
  );

  const body = (
    // min-w-0 + overflow-x-clip keep every tab body and result row contained
    // INSIDE the dropdown card — long order #s / refs truncate instead of
    // bleeding past the right edge. `clip` (not `hidden`) avoids forcing a
    // vertical scrollbar and leaves the active pill's shadow intact.
    <div className="min-w-0 overflow-x-clip">
      {/* Auto-suggest (§3.6) — the primary/first-shown pairing path (D1); the
          manual "Zoho PO" tab below is unchanged as the correction tool. */}
      <PoSuggestBanner suggestions={poSuggestions} />

      {/* Switchable tabs — Ecwid Search (default) · Link-a-Zoho-PO · Zendesk ·
          Email PO. All work for matched AND unmatched cartons. The overlay-nav
          slider has no scroller, so it must be width-constrained (flex-1 +
          min-w-0) for its pills to WRAP within the card instead of overflowing. */}
      <div ref={cardTopRef} className="mb-3 flex min-w-0 items-center gap-2">
        <HorizontalButtonSlider
          variant="nav"
          dense
          overlay
          className="min-w-0 flex-1"
          items={tabs}
          value={tab}
          onChange={(id) => setTab(id as MatchTab)}
          aria-label="Pairing tabs"
        />
        {tab === 'zendesk' && t.hiddenLinked > 0 ? (
          <HoverTooltip label={`${t.hiddenLinked} ticket(s) already linked elsewhere are hidden`}>
            <span className="ml-auto shrink-0 text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
              {t.hiddenLinked} hidden
            </span>
          </HoverTooltip>
        ) : null}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      {tab === 'ecwid' ? (
        // Ecwid Search (default) — recent-orders list, searchable by order #,
        // title, or SKU (relaxed to all orders, not just -RS). Selecting a row
        // adds its item to the carton + links the source order.
        <EcwidProductSearchInline
          receivingId={receivingId}
          popoverMode="repair_service"
          initialOrderScope="all"
          autoFocusSearch={!showOpenInUnbox}
          onSelect={u.handleAddLine}
          onClose={() => setTab('zoho_po')}
        />
      ) : tab === 'zoho_item' ? (
        <ZohoItemPairTab
          receivingId={receivingId}
          allowOffPo={orderLinked}
          onAddSku={(sel) => u.handleAddLine(sel, { allowOffPo: orderLinked })}
        />
      ) : tab === 'zoho_po' ? (
        <PoLinkTab row={row} receivingId={receivingId} />
      ) : tab === 'email' ? (
        // Email PO — search the Gmail-ingested PO worklist + link the carton's
        // tracking to a purchase order that was never imported into the system.
        <EmailPoLinkTab row={row} receivingId={receivingId} />
      ) : (
        <ZendeskMatchTab t={t} />
      )}
    </div>
  );

  // ── Linkage display ─────────────────────────────────────────────────────────
  // Once an order/PO is linked the carton IS a normal PO — its identity reads in
  // the carton header chip + the PO# card (and the PO-items accordion in unbox),
  // NOT a "linked" summary here. So Package Pairing collapses to a minimal action
  // strip (Change / add · Unlink); we don't repeat the PO as a green badge.
  // A Zendesk ticket has no other home in this surface, so it keeps its own row.
  const ticketLinkRow = hasTicket ? (
    <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
        <ZendeskMark className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-eyebrow font-black uppercase tracking-widest text-violet-700">
          Claim ticket
        </span>
        <p className="truncate text-caption font-bold font-mono text-text-default">
          {pkg.zendeskTicket}
        </p>
      </div>
      <HoverTooltip label="Unlink this Zendesk claim ticket (leaves the order pairing intact)" asChild focusable={false}>
        <Button
          variant="secondary"
          size="sm"
          icon={unlinkingTicket ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink />}
          onClick={unlinkTicket}
          disabled={unlinkingTicket}
          className="h-7 shrink-0 border-rose-200 bg-rose-50 px-2.5 text-rose-700 hover:bg-rose-100"
        >
          {unlinkingTicket ? 'Unlinking…' : 'Unlink'}
        </Button>
      </HoverTooltip>
    </div>
  ) : null;

  // Linked → collapse to a minimal action strip (the PO reads as a normal PO in
  // the header/PO# card); otherwise show the picker. A ticket-only carton keeps
  // the picker open with its ticket row above it.
  const content = (
    <div className="min-w-0 space-y-2 overflow-x-clip">
      {ticketLinkRow}
      {pickerCollapsed ? (
        <div className="flex items-center gap-2">
          <HoverTooltip label="Re-open the picker to change or add a pairing" asChild focusable={false}>
            <Button
              variant="ghost"
              size="sm"
              icon={<Link2 />}
              onClick={() => setForcePicker(true)}
              className="h-7 px-2.5 text-text-muted"
            >
              Change / add pairing
            </Button>
          </HoverTooltip>
          <HoverTooltip label="Unlink this order/PO — sends the carton back to Unfound" asChild focusable={false}>
            <Button
              variant="secondary"
              size="sm"
              icon={unlinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink />}
              onClick={unlink}
              disabled={unlinking}
              className="h-7 border-rose-200 bg-rose-50 px-2.5 text-rose-700 hover:bg-rose-100"
            >
              {unlinking ? 'Unlinking…' : 'Unlink'}
            </Button>
          </HoverTooltip>
        </div>
      ) : (
        body
      )}
    </div>
  );

  // Embedded → bare sub-section (eyebrow + content) so the unified
  // POUnboxingSection wrapper owns the single card chrome + edit pencil.
  if (embedded) {
    // Stay mounted — animate height + margin (not AnimatePresence) so the PO
    // items block above doesn't jump when the pencil toggles this section.
    return (
      <motion.div
        initial={false}
        layout="position"
        animate={
          collapsed
            ? { ...pairingCollapse.exit, marginTop: 0 }
            : {
                ...pairingCollapse.animate,
                marginTop: showTopRule ? 16 : 0,
              }
        }
        transition={pairingCollapseTransition}
        className={collapsed ? 'overflow-hidden' : 'overflow-visible'}
        aria-hidden={collapsed}
      >
        <div className={showTopRule ? 'border-t border-border-hairline pt-4' : undefined}>
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2 overflow-visible">
            <h3 className="min-w-0 shrink text-caption font-bold uppercase tracking-[0.14em] text-text-soft">
              Package Pairing
            </h3>
            {headerActions}
          </div>
          {content}
        </div>
      </motion.div>
    );
  }

  return (
    <WorkspaceCard label="Package Pairing" overflow="visible" actions={headerActions}>
      {content}
    </WorkspaceCard>
  );
}

/** The Zendesk-tickets tab body — search + candidate match cards + delivery hints. */
function ZendeskMatchTab({ t }: { t: ReturnType<typeof useTriagePanel> }) {
  return (
    <>
      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          type="text"
          value={t.matchQuery}
          onChange={(e) => t.setMatchQuery(e.target.value)}
          placeholder="Search claim tickets by #, order, email, customer…"
          className="w-full rounded-lg border border-border-soft py-2 pl-8 pr-8 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {t.candidatesFetching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-faint" />
        ) : null}
      </div>

      {t.candidatesLoading ? (
        <p className="flex items-center justify-center gap-2 py-5 text-xs text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading matches…
        </p>
      ) : t.candidatesError ? (
        <p className="rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-center text-xs text-rose-600">
          Couldn’t load Zendesk matches. Zendesk may be unconfigured.
        </p>
      ) : t.candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-4 py-5 text-center text-xs text-text-soft">
          {t.matchQuery.trim()
            ? `No tickets match “${t.matchQuery.trim()}”.`
            : 'No recent claim tickets. Search by order #, email, or customer name.'}
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
        <div className="mt-3 border-t border-border-hairline pt-3">
          <WorkspaceSectionTitle as="p" className="mb-1.5">
            Marketplace delivery signals
          </WorkspaceSectionTitle>
          <div className="space-y-1">
            {t.deliveredEmails.map((sig, i) => (
              <div
                key={`${sig.orderNumber}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-violet-50/60 px-2.5 py-1.5"
              >
                <Mail className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-text-muted">
                  Order
                  <OrderIdChip value={sig.orderNumber} display={getLast4(sig.orderNumber)} dense />
                  {sig.deliveredAt ? (
                    <span className="truncate text-text-faint">· delivered {relativeTime(sig.deliveredAt)}</span>
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
