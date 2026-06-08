'use client';

/**
 * Right-pane workspace editor for a single receiving line. Moved here verbatim
 * from `ReceivingSidebarPanel` as part of the sidebar refactor — owns its own
 * form state (edits, accordion toggles, pending API responses, audit modal
 * toggle). The sidebar/dashboard own the carton-level scan flow + line picker.
 *
 * Step 8 of the refactor: this file is created and imported by the sidebar
 * during the cutover period. Step 10 swaps the sidebar's inline render for an
 * event-driven dispatch that lets `ReceivingDashboard` mount this component
 * in the right pane instead.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { toast } from '@/lib/toast';
import {
  printReceivingLabel,
  type ReceivingLabelPayload,
} from './receiving-label-helpers';
import { ReceiveResponsePanel } from './ReceiveResponsePanel';
import { ReceivingAuditModal } from './ReceivingAuditModal';
import { markConditionSet } from './ReceivingProgressStepper';
import { useSerialLookup, type SerialMatchedOrder } from './SerialMatchResult';
import { PoLinesAccordion } from './PoLinesAccordion';
import { takeSerialEditHandoff } from './serialEditHandoff';
import { UnmatchedItemsSection } from './UnmatchedItemsSection';
import { ReceivingClaimModal } from './ReceivingClaimModal';
import { workspaceCapabilities, type ReceivingWorkspaceVariant } from './workspace-capabilities';
import { LineNotesCard } from './line-edit/LineNotesCard';
import { LineLabelPreviewCard } from './line-edit/LineLabelPreviewCard';
import { LineReceiveActionBar } from './line-edit/LineReceiveActionBar';
import { ActiveLineConditionSerial } from './line-edit/ActiveLineConditionSerial';
import { LineEditToolbar } from './line-edit/LineEditToolbar';
import { CartonContextCard } from './line-edit/CartonContextCard';
import { useZohoSync } from './line-edit/hooks/useZohoSync';
import { usePoBinding } from './line-edit/hooks/usePoBinding';
import { useReceiveAction } from './line-edit/hooks/useReceiveAction';
import { useSourcePlatform } from './line-edit/hooks/useSourcePlatform';
import { useLineSerials } from './line-edit/hooks/useLineSerials';
import { useZohoLinePrefill } from './line-edit/hooks/useZohoLinePrefill';
import { useReceivingPackageSync } from './line-edit/hooks/useReceivingPackageSync';
import { useResourceMutation } from '@/hooks';
import { useAblyClient } from '@/contexts/AblyContext';
import { WorkspaceCard } from '@/design-system/components';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { buildReceivingCopyInfo } from '@/utils/copy-all-receiving';
import { copyToClipboard } from '@/utils/_dom';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  SOURCE_PLATFORM_LABELS,
  readReceivingLineDetailsScratch,
  writeReceivingLineDetailsScratch,
  listingUrlForOpen,
  listingLinkPreview,
  receivingShareUrl,
  randomId,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

export function LineEditPanel({
  row,
  staffId,
  compact = false,
  accordionBootstrap = 'default',
  onClose,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
  itemIndex,
  itemTotal,
  variant = 'unbox',
}: {
  row: ReceivingLineRow;
  staffId: string;
  compact?: boolean;
  /** `'all'` opens Shipment PO, Item, and Support sections (table row selection). */
  accordionBootstrap?: 'default' | 'all';
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  /** 0-based index of the current item within the PO */
  itemIndex?: number;
  /** Total number of items in the PO */
  itemTotal?: number;
  /** `triage` hides unbox-only sections (photos, claim, label, receive, serial). */
  variant?: ReceivingWorkspaceVariant;
  onClose: () => void;
}) {
  // Mode capabilities — gate unbox-only sections without sprinkling
  // `variant === 'triage'` through the JSX. See workspace-capabilities.ts.
  const caps = workspaceCapabilities(variant);
  const [receivingType, setReceivingType] = useState(row.receiving_type || 'PO');
  const [qa, setQa] = useState(
    !row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status,
  );
  const [disp, setDisp] = useState(
    !row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code,
  );
  // Unfound cartons carry a meaningless carton-level placeholder grade
  // (`BRAND_NEW`); the real grade lives on each line and defaults to USED_A.
  // Seed the label condition from USED_A for unmatched cartons so the preview/
  // print matches the line pills instead of defaulting to "New".
  const initialCond =
    row.receiving_source === 'unmatched' ? 'USED_A' : row.condition_grade || 'USED_A';
  const [cond, setCond] = useState(initialCond);
  // Effective condition of the currently-selected unit on a multi-qty line.
  // Reported up from ReceivingUnitRows so the label preview/print reflects the
  // selected item rather than the line-level grade. Null on single-qty lines.
  const [unitLabelCondition, setUnitLabelCondition] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [trackingEdit, setTrackingEdit] = useState(row.tracking_number || '');
  const [zendesk, setZendesk] = useState('');
  const [serialInput, setSerialInput] = useState('');
  // RETURN flow: on serial commit we check the serial against serial_units and
  // surface "Match found" / "No match found" under the scan card. The read runs
  // before the scan upsert (see submitSerial) so it reflects prior inventory,
  // not the row we're about to write.
  const serialLookup = useSerialLookup();
  const [listingLink, setListingLink] = useState('');
  const [headerSerialEdit, setHeaderSerialEdit] = useState<{
    id?: number;
    serial_number: string;
    condition_grade?: string | null;
  } | null>(null);
  // Claim modal — opened from PhotosCard's "Make a claim" CTA. The modal
  // creates a Zendesk ticket via /api/receiving/zendesk-claim and auto-pops
  // the returned TK # back into the Support FlowSection's existing zendesk
  // field via dispatchLineUpdated.
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  // RETURN flow: when a scanned serial matches a shipped order, the match band's
  // "File return claim" CTA seeds this so the claim modal opens pre-populated
  // with the matched order + serial. Cleared on modal close.
  const [returnClaimPrefill, setReturnClaimPrefill] = useState<string | null>(null);
  // Guards the auto-bind-PO# effect so a matched order is only written to the
  // carton's PO# once (not on every re-render of the found match band).
  const autoBoundOrderRef = useRef<string | null>(null);
  const [extraTrackings, setExtraTrackings] = useState<string[]>([]);
  const [extraSerials, setExtraSerials] = useState<string[]>([]);
  const serialRef = useRef<HTMLInputElement>(null);
  /** Tracking inline editor — collapsed by default; pencil expands. Chip alone owns the visible display. */
  const [trackingEditorsOpen, setTrackingEditorsOpen] = useState(false);
  /** Full listing SearchBar — collapsed by default; pencil expands to paste/edit. */
  const [listingEditorOpen, setListingEditorOpen] = useState(false);
  /**
   * PO# inline editor. Defaults open for unmatched cartons or any row
   * without a PO# yet — those are exactly the cases where binding a PO
   * is the operator's most likely next action. Matched cartons keep the
   * compact chip + pencil affordance until the operator opts in.
   */
  const { poEditorOpen, setPoEditorOpen, poNumberEdit, setPoNumberEdit, persistPoNumber } =
    usePoBinding(row);
  const { sourcePlatform, setSourcePlatform, platformSaving, savePlatform } = useSourcePlatform(
    row,
    { listingLink },
  );
  const [auditOpen, setAuditOpen] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);
  const [phoneSharing, setPhoneSharing] = useState(false);
  const { getClient: getAblyClient } = useAblyClient();

  const persistZendeskRef = useRef(zendesk);
  const persistListingRef = useRef(listingLink);
  const persistExtraTrackingsRef = useRef(extraTrackings);
  persistZendeskRef.current = zendesk;
  persistListingRef.current = listingLink;
  persistExtraTrackingsRef.current = extraTrackings;

  const toggleTrackingEditors = useCallback(() => {
    setTrackingEditorsOpen((prev) => {
      const next = !prev;
      if (prev && !next) {
        setExtraTrackings((xs) => xs.filter((t) => t.trim().length > 0));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setReceivingType(row.receiving_type || 'PO');
    setQa(!row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status);
    setDisp(!row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code);
    setCond(row.receiving_source === 'unmatched' ? 'USED_A' : row.condition_grade || 'USED_A');
    // Clear the per-unit label override on line switch — the new line's
    // ReceivingUnitRows (if multi-qty) re-reports its selection on mount.
    setUnitLabelCondition(null);
    setTrackingEdit(row.tracking_number || '');
  }, [row.id, row.qa_status, row.disposition_code, row.condition_grade, row.tracking_number, row.receiving_type, row.receiving_source]);

  // When the carton changes, flush scratch for the previous receiving_id
  // so localStorage is not lost before loading the next carton’s scratch.
  const prevReceivingIdForFlushRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevReceivingIdForFlushRef.current;
    const next = row.receiving_id;
    if (prev != null && prev !== next) {
      writeReceivingLineDetailsScratch(prev, {
        zendesk: persistZendeskRef.current,
        listing: persistListingRef.current,
        extra_trackings: persistExtraTrackingsRef.current.filter((t) => t.trim().length > 0),
      });
    }
    prevReceivingIdForFlushRef.current = next ?? null;
  }, [row.receiving_id]);

  // Restore Zendesk, listing from localStorage when switching cartons (layout phase
  // so persist effect sees hydrated values). PO item notes load from `row.notes` (see effect below).
  useLayoutEffect(() => {
    if (row.receiving_id == null) {
      setZendesk('');
      setListingLink('');
      setNotes('');
      setExtraTrackings([]);
      setListingEditorOpen(false);
      setTrackingEditorsOpen(false);
      return;
    }
    const d = readReceivingLineDetailsScratch(row.receiving_id);
    // DB-persisted ticket # (receiving_lines.zendesk_ticket) wins over the
    // per-browser scratch; scratch remains the fallback for older rows.
    setZendesk((row.zendesk_ticket || '').trim() || d.zendesk);
    // DB-persisted listing URL wins over the per-browser scratch when present
    // (added 2026-05-27). Scratch remains the fallback for cartons that
    // pre-date the column being populated.
    setListingLink((row.receiving_listing_url || '').trim() || d.listing);
    const extras = d.extra_trackings.length > 0 ? d.extra_trackings : [];
    setExtraTrackings(extras);
    // Tracking editor stays collapsed across row changes — chip + pencil
    // pattern means the operator opens it explicitly when they need to edit.
    setTrackingEditorsOpen(false);
  }, [row.receiving_id, row.tracking_number]);

  /** Listing chip/editor: always start minimized when the selected line or carton changes. */
  useLayoutEffect(() => {
    setListingEditorOpen(false);
  }, [row.id, row.receiving_id]);

  useLayoutEffect(() => {
    setNotes(row.notes ?? '');
  }, [row.id, row.notes]);

  // Serial is per line; when moving between lines, prefill from the row's
  // already-recorded serials (most recent wins) so the sidebar reflects what
  // the table chip shows. Falls back to empty when the line has none.
  useEffect(() => {
    const localSerials = (row.serials ?? []) as Array<{ serial_number?: string | null }>;
    const latest = localSerials.length > 0
      ? String(localSerials[localSerials.length - 1]?.serial_number || '').trim()
      : '';
    setSerialInput(latest);
  }, [row.id, row.serials]);

  // Clear any RETURN match result when switching lines so a prior line's
  // "Match found"/"No match" band doesn't linger on the new line.
  useEffect(() => {
    serialLookup.reset();
  }, [row.id, serialLookup.reset]);

  useEffect(() => {
    // Consume a handoff queued by Edit on a non-active accordion row. This panel
    // remounts on every line switch (ReceivingLineWorkspace keys by row.id), so
    // it always starts with a null target — no reset needed. `take` is
    // destructive, which also makes React StrictMode's dev double-invoke a safe
    // no-op on the second pass (the store is already drained).
    const handoff = takeSerialEditHandoff(row.id);
    if (handoff) setHeaderSerialEdit(handoff);
  }, [row.id]);

  // Prefill Zendesk, listing, and serial from Zoho PO notes + line description.
  useZohoLinePrefill({ row, setZendesk, setListingLink, setSerialInput });

  // Persist scratch per carton. Skip one write right after receiving_id
  // changes (flush already saved the previous carton; load will hydrate this one).
  const previousReceivingIdForPersistRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const prev = previousReceivingIdForPersistRef.current;
    const cur = row.receiving_id;

    if (cur == null) {
      previousReceivingIdForPersistRef.current = cur;
      return;
    }

    const transitioned = prev !== cur && prev !== undefined;
    previousReceivingIdForPersistRef.current = cur;

    if (transitioned) {
      return;
    }

    writeReceivingLineDetailsScratch(cur, {
      zendesk,
      listing: listingLink,
      extra_trackings: extraTrackings.map((t) => t.trim()).filter(Boolean),
    });
  }, [zendesk, listingLink, extraTrackings, row.receiving_id]);


  // Persist the Zendesk ticket # onto the line (`receiving_lines.zendesk_ticket`)
  // so it survives reloads and shows on other surfaces (e.g. the tech workspace).
  // Claims write this server-side too; this covers manual edits to the field.
  const saveZendeskTicket = useCallback(async () => {
    if (row.id == null) return;
    const trimmed = zendesk.trim();
    const prev = (row.zendesk_ticket || '').trim();
    if (trimmed === prev) return;
    try {
      const res = await fetch('/api/receiving-lines', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, zendesk_ticket: trimmed || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) return;
      dispatchLineUpdated({ id: row.id, notes: row.notes });
    } catch {
      /* silent */
    }
  }, [row.id, row.zendesk_ticket, row.notes, zendesk]);

  // Persist listing_url to the carton (debounced) + mirror listing/platform
  // changed on other surfaces for this carton.
  useReceivingPackageSync({ row, listingLink, setListingLink, setSourcePlatform });

  const patchMut = useResourceMutation(async (fields: Record<string, unknown>) => {
    const res = await fetch('/api/receiving-lines', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, ...fields }),
    });
    const data = await res.json();
    if (data?.success && data.receiving_line) dispatchLineUpdated(data.receiving_line);
    return data;
  });
  const saving = patchMut.isPending;
  const patchMutate = patchMut.mutate;
  // Fire-and-forget line patch (callers don't await). Stable identity so the
  // CartonContextCard children don't re-render on every keystroke.
  const patch = useCallback(
    (fields: Record<string, unknown>) => { patchMutate(fields); },
    [patchMutate],
  );

  const {
    serialSubmitting,
    submitSerial,
    enqueueSerial,
    deleteSerialUnit,
    replaceSerialUnit,
    setUnitGrade,
  } = useLineSerials({
    row,
    staffId,
    receivingType,
    serialInput,
    setSerialInput,
    serialLookup,
    serialInputRef: serialRef,
  });

  const submitExtraSerial = useCallback(async (idx: number) => {
    const serial = (extraSerials[idx] ?? '').trim();
    if (!serial) return;
    await submitSerial(serial);
    setExtraSerials((xs) => xs.filter((_, j) => j !== idx));
  }, [extraSerials, submitSerial]);

  const {
    lastReceiveResponse,
    setLastReceiveResponse,
    responseExpanded,
    setResponseExpanded,
    handleReceive,
  } = useReceiveAction(row, {
    qa,
    disp,
    cond,
    notes,
    zendesk,
    listingLink,
    serialInput,
    staffId,
  });

  const poNumber = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const scanValue = poNumber || (row.receiving_id != null ? `RCV-${row.receiving_id}` : '');
  const trackingHint = (row.tracking_number || trackingEdit || '').trim();
  // Platform precedence on the printed label:
  //   1. Operator-picked platform pill
  //   2. 'Local pickup' for PICKUP receiving type
  //   3. 'Unfound' for unmatched cartons (no PO, no platform) — beats the
  //      old generic 'Unknown' so the top-left of the label tells the
  //      receiver the package never matched a PO.
  //   4. 'Unknown' as a final fallback.
  const labelPlatform = sourcePlatform
    ? (SOURCE_PLATFORM_LABELS[sourcePlatform] ?? sourcePlatform)
    : String(receivingType || 'PO').toUpperCase() === 'PICKUP'
      ? 'Local pickup'
      : row.receiving_source === 'unmatched'
        ? 'Unfound'
        : 'Unknown';
  const labelDate = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  // On a multi-qty line, the printed/previewed label tracks the selected
  // unit's condition (reported up from ReceivingUnitRows) so each item gets a
  // label with its own grade. Single-qty lines use the line-level grade.
  const isMultiQtyLine = (row.quantity_expected ?? 0) > 1;
  const labelConditionCode = isMultiQtyLine && unitLabelCondition ? unitLabelCondition : cond;
  const labelPayload: ReceivingLabelPayload = {
    receivingId: row.receiving_id ?? null,
    scanValue,
    platform: labelPlatform,
    zendeskTicket: zendesk.trim() || undefined,
    // Passed so the corner falls back to tracking last-4 when scanValue
    // is an internal RCV-{id} (unmatched cartons with no PO).
    trackingNumber: trackingHint || null,
    notes: notes.trim(),
    conditionCode: labelConditionCode,
    receivingType,
    date: labelDate,
  };

  const runPrintLabel = useCallback(() => {
    let didPrint = false;
    if (scanValue.trim()) {
      printReceivingLabel(labelPayload);
      didPrint = true;
    } else {
      const skuTrim = (row.sku || '').trim();
      if (skuTrim) {
        printProductLabel({
          sku: skuTrim,
          title: row.item_name ?? undefined,
          serialNumber: serialInput.trim() || undefined,
        });
        didPrint = true;
      }
    }
    if (didPrint) {
      // Flip the print step (#5) on the workspace stepper. Persist so the
      // dot stays filled across re-mounts; the workspace re-reads the flag
      // on mount and listens for this event during the current session.
      try {
        window.localStorage.setItem(
          `receiving-label-printed:${row.id}`,
          String(Date.now()),
        );
      } catch {
        /* private-mode / quota — non-fatal */
      }
      window.dispatchEvent(
        new CustomEvent('receiving-label-printed', { detail: { line_id: row.id } }),
      );
    }
  }, [scanValue, labelPayload, row.sku, row.item_name, row.id, serialInput]);

  // Print popup opens first (synchronous), then receive fires in the
  // background — the button does NOT wait for Zoho to return.
  const handlePrintAndReceive = useCallback(() => {
    runPrintLabel();
    handleReceive('zoho_receive');
  }, [runPrintLabel, handleReceive]);

  const canPrintReview = Boolean(scanValue.trim() || (row.sku || '').trim());
  const canReceiveReview = row.receiving_id != null;
  /** Print · receive must do both; previously SKU alone enabled the button while receive no-opped. */
  const combinedReviewDisabled = !canReceiveReview || !canPrintReview;
  const isSinglePoItem = itemTotal === 1;
  const receiveMenuLabel = isSinglePoItem ? 'Receive' : 'Receive all';
  const printReceivePrimaryLabel = 'Print · receive';
  const splitMenuAriaLabel = isSinglePoItem
    ? 'Print only, mark as scanned, or receive (no print)'
    : 'Print only, mark as scanned, or receive all (no print)';
  const splitMenuHoverTitle = isSinglePoItem
    ? 'Hover for print-only, mark as scanned, or receive without print'
    : 'Hover for print-only, mark as scanned, or receive all without print';
  const printThenReceiveTitle =
    row.receiving_id == null && !scanValue.trim() && !(row.sku || '').trim()
      ? 'Need a shipment link or SKU to continue'
      : isSinglePoItem
        ? 'Print label (if available), then receive this line'
        : 'Print label (if available), then receive every open line on this PO';

  const listingOpenHref = listingUrlForOpen(listingLink);
  // Zendesk ticket chip — surfaced inline in the chip row (between the listing
  // link and the PO#) whenever a ticket is on file. Display strips a leading
  // '#' and pulls the numeric id out of a pasted ticket URL.
  const zendeskTrimmed = zendesk.trim();
  const zendeskHref = zendeskTicketUrl(zendeskTrimmed);
  const zendeskChipDisplay = (() => {
    const raw = zendeskTrimmed.replace(/^#/, '').trim();
    const fromUrl = raw.match(/tickets\/(\d+)/);
    if (fromUrl) return fromUrl[1];
    return raw.length > 12 ? raw.slice(0, 12) : raw;
  })();
  const primaryTrackingTrimmed = trackingEdit.trim();
  const filledExtraTrackingsCount = extraTrackings.filter((t) => t.trim().length > 0).length;
  const listingPreviewLabel = listingLinkPreview(listingLink);

  // RETURN flow: pair the carton with the shipped order a scanned serial
  // matched. We write the matched sales-order # into the carton's PO# (when it
  // has none yet) so an unfound return "graduates" to a matched carton — the
  // same mechanism the Ecwid repair-service link uses. Guarded by a ref so a
  // lingering "found" match band doesn't re-PATCH on every render.
  useEffect(() => {
    if (receivingType !== 'RETURN') return;
    if (serialLookup.state !== 'found') return;
    const orderNo = (serialLookup.matchedOrder?.order_id || '').trim();
    if (!orderNo) return;
    if (poNumber) return; // never overwrite an operator/Zoho-set PO#
    if (autoBoundOrderRef.current === orderNo) return;
    autoBoundOrderRef.current = orderNo;
    void persistPoNumber(orderNo);
  }, [receivingType, serialLookup.state, serialLookup.matchedOrder, poNumber, persistPoNumber]);

  // Reset the auto-bind guard when the line changes so a new carton can bind
  // its own matched order.
  useEffect(() => {
    autoBoundOrderRef.current = null;
  }, [row.id]);

  // "File return claim" CTA from the serial-match band: ensure the order is
  // paired (auto-bind covers the case where the effect was skipped), then open
  // the claim modal pre-filled with the matched order + serial for review.
  const handleFileReturnClaim = useCallback(
    (matchedOrder: SerialMatchedOrder | null, explicitSerial?: string) => {
      const orderNo = (matchedOrder?.order_id || '').trim();
      const title = (matchedOrder?.product_title || '').trim();
      const sn = (explicitSerial ?? serialLookup.serial).trim();
      if (orderNo && !poNumber) {
        autoBoundOrderRef.current = orderNo;
        void persistPoNumber(orderNo);
      }
      const lines = ['Return received and matched to a previously shipped order.'];
      if (title) lines.push(`Item: ${title}.`);
      if (orderNo) lines.push(`Original order: ${orderNo}.`);
      if (matchedOrder?.tracking_number) lines.push(`Shipped tracking: ${matchedOrder.tracking_number}.`);
      if (sn) lines.push(`Serial: ${sn}.`);
      setReturnClaimPrefill(lines.join(' '));
      setClaimModalOpen(true);
    },
    [serialLookup.serial, poNumber, persistPoNumber],
  );

  const { zohoSyncing, syncWithZoho } = useZohoSync(row, {
    staffId,
    listingLink,
    zendesk,
    setListingLink,
    setZendesk,
  });

  const handleShare = useCallback(async () => {
    if (!row.receiving_id) {
      toast.error('No receiving package linked yet');
      return;
    }
    const url = receivingShareUrl(row.receiving_id, row.id);
    const poLabel = row.zoho_purchaseorder_number || `Package #${row.receiving_id}`;
    const title = `Receiving — ${poLabel}`;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, url });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
    const ok = await copyToClipboard(url);
    if (ok) toast.success('Link copied to clipboard');
    else toast.error('Could not copy link');
  }, [row.receiving_id, row.zoho_purchaseorder_number, row.id]);

  // Push a "Shared from computer" sheet to the operator's paired phone. Publishes
  // `receiving_share_to_phone` on `station:{staffId}` — implicit pairing, the
  // channel name is the gate. ReceivingShareToPhoneSheet (mounted in the mobile
  // shell) pops the sheet + Take photos CTA to the existing capture page.
  const handleSharePhone = useCallback(async () => {
    if (!row.receiving_id) {
      toast.error('No receiving package linked yet');
      return;
    }
    const staffIdNum = Number(staffId) || 0;
    if (staffIdNum <= 0) {
      toast.error('Sign in to share to your phone');
      return;
    }
    setPhoneSharing(true);
    try {
      const client = await getAblyClient();
      if (!client) {
        toast.error('Realtime unavailable — try again');
        return;
      }
      const ch = client.channels.get(`station:${staffIdNum}`);
      await ch.publish('receiving_share_to_phone', {
        receiving_id: row.receiving_id,
        po_label: row.zoho_purchaseorder_number || `Package #${row.receiving_id}`,
        tracking: (row.tracking_number || '').trim() || null,
        request_id: randomId(),
        requested_by_staff_id: staffIdNum,
      });
      toast.success('Shared to your phone');
    } catch {
      toast.error('Could not share to phone');
    } finally {
      setPhoneSharing(false);
    }
  }, [row.receiving_id, row.zoho_purchaseorder_number, row.tracking_number, staffId, getAblyClient]);

  const handleCopyAll = useCallback(async () => {
    if (!row.receiving_id) {
      toast.error('No receiving package linked yet');
      return;
    }
    setCopyingAll(true);
    try {
      const res = await fetch(`/api/receiving/${row.receiving_id}`, { cache: 'no-store' });
      const data = await res.json();
      const lines = data?.success && Array.isArray(data.lines) ? data.lines : [];
      const shareUrl = receivingShareUrl(row.receiving_id, row.id);
      const text = buildReceivingCopyInfo({
        carton: data?.success ? data.receiving : null,
        lines,
        scratch: {
          zendesk,
          listing: listingLink,
          extraTrackings: extraTrackings.filter((t) => t.trim().length > 0),
        },
        currentLine: row,
        shareUrl,
      });
      const ok = await copyToClipboard(text);
      if (ok) toast.success('Copied receiving details');
      else toast.error('Could not copy to clipboard');
    } catch {
      toast.error('Failed to build copy text');
    } finally {
      setCopyingAll(false);
    }
  }, [row, staffId, zendesk, listingLink, extraTrackings]);

  return (
    <>
    <div className="relative flex h-full min-h-0 flex-col bg-gray-50">
      <LineEditToolbar
        receivingId={row.receiving_id ?? null}
        zohoSyncing={zohoSyncing}
        busy={saving || platformSaving}
        copyingAll={copyingAll}
        phoneSharing={phoneSharing}
        onRefresh={() => void syncWithZoho()}
        onShare={() => void handleShare()}
        onSharePhone={() => void handleSharePhone()}
        onAudit={() => setAuditOpen(true)}
        onCopy={() => void handleCopyAll()}
      />

      {/* Scroll surface — owns the centered hero column. Padding-bottom
          clears the bottom sticky save bar so the last card never hides under it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
          {/* Photos + Claim + shipment context (listing, PO#, tracking,
              platform + type pills) share one WorkspaceCard so the operator
              sees a single bordered surface. */}
          <CartonContextCard
            receivingId={row.receiving_id ?? null}
            staffId={staffId}
            isUnmatched={row.receiving_source === 'unmatched'}
            // Photos + Claim are unbox-only — hidden in triage (identify step).
            showStaffPhotoRow={caps.photos}
            onMakeClaim={caps.claim ? () => setClaimModalOpen(true) : undefined}
            listingLink={listingLink}
            setListingLink={setListingLink}
            listingEditorOpen={listingEditorOpen}
            setListingEditorOpen={setListingEditorOpen}
            listingOpenHref={listingOpenHref}
            listingPreviewLabel={listingPreviewLabel}
            poDisplay={poNumber}
            poEditorOpen={poEditorOpen}
            setPoEditorOpen={setPoEditorOpen}
            poNumberEdit={poNumberEdit}
            setPoNumberEdit={setPoNumberEdit}
            onCommitPoNumber={(v) => {
              const trimmed = v.trim();
              const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
              if (trimmed !== current) void persistPoNumber(trimmed);
            }}
            zendeskTrimmed={zendeskTrimmed}
            zendeskHref={zendeskHref}
            zendeskChipDisplay={zendeskChipDisplay}
            primaryTrackingTrimmed={primaryTrackingTrimmed}
            filledExtraTrackingsCount={filledExtraTrackingsCount}
            trackingEditorsOpen={trackingEditorsOpen}
            onToggleTrackingEditors={toggleTrackingEditors}
            trackingEdit={trackingEdit}
            setTrackingEdit={setTrackingEdit}
            onCommitTracking={(v) => {
              const trimmed = v.trim();
              if (trimmed !== (row.tracking_number || '').trim()) {
                patch({ zoho_reference_number: trimmed || null });
              }
            }}
            extraTrackings={extraTrackings}
            setExtraTrackings={setExtraTrackings}
            platformValue={sourcePlatform}
            onPlatformSelect={(next) => {
              setSourcePlatform(next);
              void savePlatform(next);
            }}
            receivingType={receivingType}
            onTypeSelect={(next) => {
              setReceivingType(next);
              patch({ receiving_type: next });
            }}
          />

          {/* PO Items card — title + qty + sku + serial chips per row, with
              the active row's bubble carrying an integrated condition-pill
              row. The standalone ContextCard and Condition section that used
              to live outside this card are gone — both signals now live
              inside the active PO item. */}
          {/* Unmatched cartons swap in UnmatchedItemsSection here (Ecwid
              add-item + Link Repair Service). Matched cartons keep the
              canonical PoLinesAccordion driven by Zoho data. Same slot, so
              the rest of the workspace (chips, serial, photos, sticky bar)
              is identical across the two flows. */}
          {row.receiving_id != null ? (
            row.receiving_source === 'unmatched' ? (
              <UnmatchedItemsSection
                receivingId={row.receiving_id}
                staffId={staffId}
                showSerialScan={caps.serialScan}
                sourcePlatformHint={sourcePlatform || undefined}
                receivingTypeHint={receivingType}
                listingUrlHint={listingLink || undefined}
                onFileReturnClaim={handleFileReturnClaim}
                // Mirror the picked grade into `cond` so the label preview/print
                // tracks it. The matched-carton flow does this through
                // ActiveLineConditionSerial.onConditionChange; an unfound carton
                // owns its condition internally, so without this the label
                // would never reflect the operator's grade.
                onActiveConditionChange={(next) => {
                  setCond(next);
                  setUnitLabelCondition(next);
                }}
              />
            ) : (
              <PoLinesAccordion
                receivingId={row.receiving_id}
                activeLineId={row.id}
                readOnly={!caps.editLines}
                activeConditionOverride={isMultiQtyLine ? (unitLabelCondition ?? cond) : cond}
                activeSerialActions={{
                  editingSerialId: headerSerialEdit?.id ?? null,
                  // Only called for the active row — the accordion routes a
                  // non-active row's Edit through the handoff store + line
                  // switch, which this panel consumes on (re)mount.
                  onEdit: (s) => setHeaderSerialEdit(s),
                  onDelete: (s, lineId) => {
                    if (s.id == null) return;
                    if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                    if (headerSerialEdit?.id === s.id) setHeaderSerialEdit(null);
                    void deleteSerialUnit(s.id, lineId);
                  },
                }}
                activeRowSlot={({ serials }) => !caps.serialScan ? null : (
                  <ActiveLineConditionSerial
                    serials={serials}
                    lineId={row.id}
                    receivingId={row.receiving_id ?? null}
                    quantityExpected={row.quantity_expected ?? null}
                    cond={cond}
                    receivingType={receivingType}
                    serialSubmitting={serialSubmitting}
                    editingSerial={headerSerialEdit}
                    serialLookup={serialLookup}
                    onFileReturnClaim={handleFileReturnClaim}
                    onSubmitSerial={(sn, grade) => enqueueSerial(sn, grade)}
                    onDeleteSerialUnit={(id, lineId) => void deleteSerialUnit(id, lineId)}
                    onReplaceSerialUnit={(original, next) => void replaceSerialUnit(original, next)}
                    onSetUnitGrade={(id, grade) => void setUnitGrade(id, grade)}
                    onActiveConditionChange={setUnitLabelCondition}
                    onConditionChange={(next) => {
                      setCond(next);
                      markConditionSet(row.id);
                      void patch({ condition_grade: next });
                    }}
                    onEditingSerialChange={setHeaderSerialEdit}
                  />
                )}
              />
            )
          ) : null}

          {/* Notes card — standalone so the operator can leave context next
              to the photos + chips without it nesting inside the active PO
              row. Saves on blur (same contract SerialCard used). */}
          <LineNotesCard
            value={notes}
            onChange={setNotes}
            onBlur={() => {
              if (notes !== (row.notes || '')) void patch({ notes });
            }}
          />

          {/* Photos + Make a Claim are co-located inside the Staff card
              above — no standalone PhotosCard is needed in the column. */}

          {/* Label preview — unbox-only (you print at unbox, not at triage). */}
          {caps.labelPreview ? (
            <LineLabelPreviewCard
              scanValue={scanValue}
              labelPayload={labelPayload}
              sku={row.sku}
              itemName={row.item_name}
              serialNumber={serialInput.trim()}
            />
          ) : null}

          {lastReceiveResponse ? (
            <WorkspaceCard label="Last receive" bodyClassName="px-0 py-0">
              <ReceiveResponsePanel
                response={lastReceiveResponse}
                expanded={responseExpanded}
                onToggle={() => setResponseExpanded((v) => !v)}
                onDismiss={() => {
                  setLastReceiveResponse(null);
                  setResponseExpanded(false);
                }}
              />
            </WorkspaceCard>
          ) : null}
        </div>
      </div>

      {/* Print·receive — unbox-only; triage just identifies. A direct child of
          the (relative, full-height) panel so the FloatingButton docks to the
          bottom of the right pane regardless of how short the content is. The
          scroll column reserves room with pb-32 so the last card clears it. */}
      {caps.receiveBar ? (
        <LineReceiveActionBar
          assignedTechId={row.assigned_tech_id}
          primaryLabel={printReceivePrimaryLabel}
          primaryTitle={printThenReceiveTitle}
          primaryDisabled={combinedReviewDisabled}
          splitMenuAriaLabel={splitMenuAriaLabel}
          splitMenuHoverTitle={splitMenuHoverTitle}
          canPrint={canPrintReview}
          canReceive={canReceiveReview}
          receiveMenuLabel={receiveMenuLabel}
          receiveMenuTitle={
            row.receiving_id == null ? 'Line must be linked to a shipment' : undefined
          }
          onPrintAndReceive={() => void handlePrintAndReceive()}
          onPrintOnly={() => runPrintLabel()}
          onMarkScanned={() => void handleReceive('scan_only')}
          onReceive={() => void handleReceive('zoho_receive')}
        />
      ) : null}

      {/* Triage's terminal action. Classification / PO# / items already persist
          on change, so this confirms the carton is identified and hands it to
          the unbox queue (clears selection → the rail auto-selects the next). */}
      {caps.saveBar ? (
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => {
              toast.success('Saved for unbox');
              onClose();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-blue-700 active:scale-[0.99]"
          >
            Save for unbox
          </button>
        </div>
      ) : null}
    </div>
    {row.receiving_id != null ? (
      <ReceivingAuditModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        receivingId={row.receiving_id}
      />
    ) : null}
    <ReceivingClaimModal
      open={claimModalOpen}
      row={row}
      prefillReason={returnClaimPrefill ?? undefined}
      onClose={() => {
        setClaimModalOpen(false);
        setReturnClaimPrefill(null);
      }}
      onTicketCreated={(tk) => {
        // Keep the in-memory zendesk value in sync (persisted to the line by
        // the claim route + the Receive/patch save flow). The header pill reads
        // receiving_lines.zendesk_ticket, so the freshly-filed # shows there.
        if (!zendesk.trim()) setZendesk(tk);
        // Broadcast so other surfaces (Recent rail, table) can refresh
        // their cached row if they hold a zendesk_ticket field.
        dispatchLineUpdated({ id: row.id, notes: row.notes });
      }}
    />
    </>
  );
}
