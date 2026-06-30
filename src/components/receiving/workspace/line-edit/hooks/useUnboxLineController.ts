'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  printReceivingLabel,
  type ReceivingLabelPayload,
} from '../../receiving-label-helpers';
import { markConditionSet } from '../../ReceivingProgressStepper';
import { useSerialLookup, type SerialMatchedOrder } from '../../SerialMatchResult';
import { takeSerialEditHandoff } from '../../serialEditHandoff';
import { printProductLabel } from '@/lib/print/printProductLabel';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { useLineSerials } from './useLineSerials';
import { useReceiveAction } from './useReceiveAction';
import { useZohoLinePrefill } from './useZohoLinePrefill';
import { useReceivingLineCore } from './useReceivingLineCore';
import { dispatchUnboxRailLineUpdated } from '@/components/sidebar/receiving/unbox-rail-events';
import { useReceivingTypeLabel, usePlatformMeta } from '@/hooks/useCatalog';
import { useSetting } from '@/hooks/useSettings';
import type { LabelEditDraft } from '../LabelEditPopover';

/**
 * Controller for the UNBOX + TRIAGE workspace display. Composes the mode-agnostic
 * `useReceivingLineCore` (carton identity / scratch / copy·share / priority) and
 * layers the unbox-specific domain on top: condition grade, serial scanning, the
 * receive/print action, the RETURN serial-match flow, and the printed-label
 * payload. Returns `{ ...core, ...unbox }` so the panel reads one object.
 *
 * Testing has its own controller (Phase 3) that composes the SAME core but swaps
 * this layer for verdicts + unit-id minting — so the shared carton logic lives in
 * exactly one place.
 */
export function useUnboxLineController(
  row: ReceivingLineRow,
  staffId: string,
  { itemTotal }: { itemTotal?: number },
) {
  const core = useReceivingLineCore(row, staffId, {
    dispatchLine: dispatchUnboxRailLineUpdated,
  });
  // Resolve a receiving-type code → its org-catalog label for the printed face.
  const resolveTypeLabel = useReceivingTypeLabel();
  // Resolve a source_platform slug → its org-catalog label for the printed face.
  const resolvePlatformMeta = usePlatformMeta();

  const [qa, setQa] = useState(
    !row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status,
  );
  const [disp, setDisp] = useState(
    !row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code,
  );
  // Unfound cartons carry a placeholder carton grade (BRAND_NEW); the real grade
  // lives per line and defaults to USED_A.
  const initialCond =
    row.receiving_source === 'unmatched' ? 'USED_A' : row.condition_grade || 'USED_A';
  const [cond, setCond] = useState(initialCond);
  // Effective condition of the selected unit on a multi-qty line (reported up
  // from ReceivingUnitRows). Null on single-qty lines.
  const [unitLabelCondition, setUnitLabelCondition] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [serialInput, setSerialInput] = useState('');
  // Explicit "no serial number" waiver for this line (mutually exclusive with a
  // captured serial). Carries an auditable reason code and satisfies the optional
  // serial-confirmation gate (receiving.requireSerialConfirmation).
  const [serialAbsent, setSerialAbsent] = useState(false);
  const [serialAbsentReason, setSerialAbsentReason] = useState<string | null>(null);
  // RETURN flow: on serial commit we check the serial against serial_units.
  const serialLookup = useSerialLookup();
  const [headerSerialEdit, setHeaderSerialEdit] = useState<{
    id?: number;
    serial_number: string;
    condition_grade?: string | null;
  } | null>(null);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [returnClaimPrefill, setReturnClaimPrefill] = useState<string | null>(null);
  // Guards the auto-bind-PO# effect so a matched order is only written once.
  const autoBoundOrderRef = useRef<string | null>(null);
  const [extraSerials, setExtraSerials] = useState<string[]>([]);
  const serialRef = useRef<HTMLInputElement>(null);

  // Reset the unbox-specific buffers on line/carton change. (Carton-level resets
  // live in the core.)
  useEffect(() => {
    setQa(!row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status);
    setDisp(!row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code);
    setCond(row.receiving_source === 'unmatched' ? 'USED_A' : row.condition_grade || 'USED_A');
    setUnitLabelCondition(null);
  }, [row.id, row.qa_status, row.disposition_code, row.condition_grade, row.receiving_source]);

  useLayoutEffect(() => {
    setNotes(row.notes ?? '');
  }, [row.id, row.notes]);

  // Serial is per line; prefill from the row's recorded serials (most recent
  // wins) so the panel reflects what the table chip shows.
  useEffect(() => {
    const localSerials = (row.serials ?? []) as Array<{ serial_number?: string | null }>;
    const latest = localSerials.length > 0
      ? String(localSerials[localSerials.length - 1]?.serial_number || '').trim()
      : '';
    setSerialInput(latest);
  }, [row.id, row.serials]);

  // Clear the no-serial waiver whenever the active line changes (it's per-line).
  useEffect(() => {
    setSerialAbsent(false);
    setSerialAbsentReason(null);
  }, [row.id]);

  // Quick-return hotkey: Escape re-focuses the serial scan input from anywhere
  // in the unbox panel, so the operator can resume scanning without reaching for
  // the mouse. Only fires when no modal/dialog/select is currently active
  // (avoids intercepting Escape from popovers, search fields, select elements).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (active === serialRef.current) return;
      const tag = (active as HTMLElement | null)?.tagName ?? '';
      // Let Escape do its natural job inside text inputs and selects — only
      // intercept when focus is on a button, icon, or neutral element.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Aria-modal or role=dialog above us → a popover is open, let it handle the key.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      serialRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Clear any RETURN match when switching lines.
  useEffect(() => {
    serialLookup.reset();
  }, [row.id, serialLookup.reset]);

  // Consume a serial-edit handoff queued by Edit on a non-active accordion row.
  useEffect(() => {
    const handoff = takeSerialEditHandoff(row.id);
    if (handoff) setHeaderSerialEdit(handoff);
  }, [row.id]);

  // Prefill Zendesk, listing, and serial from Zoho PO notes + line description.
  useZohoLinePrefill({
    row,
    setZendesk: core.setZendesk,
    setListingLink: core.setListingLink,
    setSerialInput,
  });

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
    receivingType: core.receivingType,
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
    receiving,
    receiveResult,
    setReceiveResult,
    responseExpanded,
    setResponseExpanded,
    handleReceive,
  } = useReceiveAction(row, {
    qa,
    disp,
    cond,
    notes,
    zendesk: core.zendesk,
    listingLink: core.listingLink,
    serialInput,
    serialAbsent,
    serialAbsentReason,
    staffId,
  });

  const scanValue = core.poNumber || (row.receiving_id != null ? `RCV-${row.receiving_id}` : '');
  const trackingHint = (row.tracking_number || core.trackingEdit || '').trim();
  // Platform precedence on the printed label.
  const derivedPlatform = core.sourcePlatform
    ? resolvePlatformMeta(core.sourcePlatform).label
    : String(core.receivingType || 'PO').toUpperCase() === 'PICKUP'
      ? 'Local pickup'
      : row.receiving_source === 'unmatched'
        ? 'Unfound'
        : 'Unknown';
  const derivedDate = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  const isMultiQtyLine = (row.quantity_expected ?? 0) > 1;
  const labelConditionCode = isMultiQtyLine && unitLabelCondition ? unitLabelCondition : cond;

  // Custom-print override for the label-only FACE bits (Edit on the label
  // preview). These have no clean canonical home / are display-only choices —
  // platform display, date, and the bottom-right corner source (order# / ticket#
  // / tracking#). Notes / condition / reference / type persist through their own
  // handlers, so the payload below already reflects them. Reset per carton so a
  // custom print never leaks to the next line. See LabelEditPopover.
  const [labelOverride, setLabelOverride] = useState<{
    platform?: string;
    date?: string;
    cornerMode?: 'order' | 'ticket' | 'tracking';
    ticket?: string;
    tracking?: string;
  }>({});
  useEffect(() => {
    setLabelOverride({});
  }, [row.id]);

  // Numeric ticket parsed from the carton's Zendesk field (same rule the label
  // corner uses): plain #digits only — URLs / free text don't count.
  const derivedTicket = (/^#?(\d+)$/.exec(core.zendesk.replace(/\s+/g, ''))?.[1]) ?? '';

  const labelPlatform = labelOverride.platform ?? derivedPlatform;
  const labelDate = labelOverride.date ?? derivedDate;
  const cornerMode: 'order' | 'ticket' | 'tracking' =
    labelOverride.cornerMode ?? (derivedTicket ? 'ticket' : 'order');
  const cornerTicket = labelOverride.ticket ?? derivedTicket;
  const cornerTracking = labelOverride.tracking ?? trackingHint;

  // Assemble the exact payload a popover draft previews + prints. The bottom-
  // right corner is operator-chosen, so we steer the label-corner helper:
  //   ticket   → set zendeskTicket    (helper shows `#ticket`)
  //   tracking → force scanValue to the internal `RCV-{id}` handle + set
  //              trackingNumber       (helper falls through to tracking last-4)
  //   order    → drop both so it shows the order/PO last-4.
  // labelPayload (the always-on card preview) is just this run over the current
  // defaults, so the card and popover can never drift.
  const buildLabelPayload = useCallback(
    (draft: LabelEditDraft): ReceivingLabelPayload => {
      const rcv = row.receiving_id != null ? `RCV-${row.receiving_id}` : '';
      const base = {
        receivingId: row.receiving_id ?? null,
        platform: draft.platform,
        notes: draft.notes.trim(),
        conditionCode: draft.conditionCode,
        receivingType: draft.receivingType || null,
        // Catalog label so a renamed/custom type prints correctly on the face.
        receivingTypeLabel: resolveTypeLabel(draft.receivingType) || null,
        date: draft.date,
      };
      if (draft.cornerMode === 'ticket') {
        return {
          ...base,
          scanValue: draft.reference.trim() || rcv,
          zendeskTicket: draft.ticket.trim() || undefined,
          trackingNumber: trackingHint || null,
        };
      }
      if (draft.cornerMode === 'tracking') {
        return {
          ...base,
          scanValue: rcv,
          zendeskTicket: undefined,
          trackingNumber: draft.tracking.trim() || trackingHint || null,
        };
      }
      return {
        ...base,
        scanValue: draft.reference.trim() || rcv,
        zendeskTicket: undefined,
        trackingNumber: trackingHint || null,
      };
    },
    [row.receiving_id, trackingHint, resolveTypeLabel],
  );

  // Seed values for the Edit-label popover. Reference seeds from the real PO#
  // (empty on an unfound carton), not the `R-{id}` corner fallback.
  const labelDraftDefaults: LabelEditDraft = {
    platform: labelPlatform,
    receivingType: (core.receivingType || '').toUpperCase(),
    notes,
    conditionCode: labelConditionCode,
    cornerMode,
    reference: core.poNumber,
    ticket: cornerTicket,
    tracking: cornerTracking,
    date: labelDate,
  };

  const labelPayload: ReceivingLabelPayload = buildLabelPayload(labelDraftDefaults);

  // Stamp the "label printed" marker + event so the row chips flip. One place,
  // shared by the default print and the custom print.
  const markLabelPrinted = useCallback(() => {
    try {
      window.localStorage.setItem(`receiving-label-printed:${row.id}`, String(Date.now()));
    } catch {
      /* private-mode / quota — non-fatal */
    }
    window.dispatchEvent(
      new CustomEvent('receiving-label-printed', { detail: { line_id: row.id } }),
    );
  }, [row.id]);

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
    if (didPrint) markLabelPrinted();
  }, [scanValue, labelPayload, row.sku, row.item_name, serialInput, markLabelPrinted]);

  // Custom print (Edit label → Save & print): persist what has a home (notes /
  // condition / reference / type), keep the label-only bits (platform / date /
  // corner choice) as an override, then print the EXACT previewed payload built
  // from the draft (not stale state, which wouldn't have the just-set values
  // yet this tick).
  const applyAndPrintLabel = useCallback(
    (draft: LabelEditDraft) => {
      const nextNotes = draft.notes;
      const nextCond = draft.conditionCode;
      const nextRef = draft.reference.trim();
      const nextType = (draft.receivingType || '').toUpperCase();
      const notesChanged = nextNotes !== notes;
      const condChanged = nextCond !== cond;

      if (notesChanged) setNotes(nextNotes);
      if (condChanged) {
        setCond(nextCond);
        markConditionSet(row.id);
      }
      if (notesChanged || condChanged) {
        void core.patch({ notes: nextNotes, condition_grade: nextCond });
      }
      if (nextRef && nextRef !== core.poNumber) {
        void core.persistPoNumber(nextRef);
      }
      if (nextType && nextType !== (core.receivingType || '').toUpperCase()) {
        core.setReceivingType(nextType);
        void core.saveType(nextType);
      }
      // Label-only / display-only choices — kept as a print-time override so the
      // card preview reflects them, but never written to the record.
      setLabelOverride({
        platform: draft.platform,
        date: draft.date,
        cornerMode: draft.cornerMode,
        ticket: draft.ticket,
        tracking: draft.tracking,
      });

      printReceivingLabel(buildLabelPayload(draft));
      markLabelPrinted();
    },
    [
      notes, cond, row.id,
      core.patch, core.poNumber, core.persistPoNumber, core.receivingType, core.setReceivingType, core.saveType,
      buildLabelPayload, markLabelPrinted,
    ],
  );

  // Unfound cartons have no Zoho PO to receive against — never fire a Zoho
  // purchase-receive for them. The primary CTA becomes "Receive locally"
  // (print + local_receive): lines advance to RECEIVED locally (NOT just
  // SCANNED), and Zoho is left untouched. The Zoho-receive menu option is
  // disabled. ("Mark as scanned" stays available as the explicit scan_only path.)
  const isUnfound = row.receiving_source === 'unmatched';

  const handlePrintAndReceive = useCallback(() => {
    runPrintLabel();
    handleReceive(isUnfound ? 'local_receive' : 'zoho_receive');
  }, [runPrintLabel, handleReceive, isUnfound]);

  const canPrintReview = Boolean(scanValue.trim() || (row.sku || '').trim());
  const canReceiveReview = row.receiving_id != null;
  // Zoho receive is only valid for matched cartons; unfound stays local-only.
  const canZohoReceive = canReceiveReview && !isUnfound;
  // Optional org gate: Receive stays blocked until the operator captures a serial
  // OR explicitly waives it (no-serial + reason). Default off — non-breaking.
  const requireSerialConfirmation =
    useSetting<boolean>('receiving', 'receiving.requireSerialConfirmation').value ?? false;
  const hasCapturedSerial =
    serialInput.trim().length > 0 ||
    (row.serials ?? []).some(
      (s) => String((s as { serial_number?: string | null }).serial_number ?? '').trim().length > 0,
    );
  const serialWaived = serialAbsent && Boolean(serialAbsentReason);
  const serialConfirmed = !requireSerialConfirmation || hasCapturedSerial || serialWaived;
  const combinedReviewDisabled = !canReceiveReview || !canPrintReview || !serialConfirmed;
  const isSinglePoItem = itemTotal === 1;
  const receiveMenuLabel = isSinglePoItem ? 'Receive' : 'Receive all';
  const printReceivePrimaryLabel = isUnfound ? 'Receive locally' : receiveMenuLabel;
  // Unfound cartons have no Zoho/scan options in the menu — just print-only and
  // a local "receive all". Keep the menu copy honest so it matches what's shown.
  const splitMenuAriaLabel = isUnfound
    ? 'Print only, or receive all locally (no print)'
    : isSinglePoItem
      ? 'Print only, mark as scanned, or receive (no print)'
      : 'Print only, mark as scanned, or receive all (no print)';
  const splitMenuHoverTitle = isUnfound
    ? 'Hover for print-only or receive all locally — Zoho is not touched'
    : isSinglePoItem
      ? 'Hover for print-only, mark as scanned, or receive without print'
      : 'Hover for print-only, mark as scanned, or receive all without print';
  const receiveMenuTitle = isUnfound
    ? 'Unfound carton — no Zoho PO to receive against; use Receive locally'
    : row.receiving_id == null
      ? 'Line must be linked to a shipment'
      : undefined;
  const printThenReceiveTitle =
    row.receiving_id == null && !scanValue.trim() && !(row.sku || '').trim()
      ? 'Need a shipment link or SKU to continue'
      : isUnfound
        ? 'Print label (if available), then receive locally — unfound carton, Zoho is not touched'
        : isSinglePoItem
          ? 'Print label (if available), then receive this line'
          : 'Print label (if available), then receive every open line on this PO';

  // Pair the carton with the shipped order a scanned serial matched. Fires for
  // ANY line once a return is detected (not just a pre-typed RETURN) — the server
  // has already persisted the link + carton display rep; this mirrors the order#
  // into the PO# field instantly for the label/scan value. Guarded so it writes
  // once and never overwrites an operator/Zoho-set PO#.
  useEffect(() => {
    if (serialLookup.state !== 'found') return;
    const orderNo = (serialLookup.matchedOrder?.order_id || '').trim();
    if (!orderNo) return;
    if (autoBoundOrderRef.current === orderNo) return;
    autoBoundOrderRef.current = orderNo;
    // Populate the listing link so the carton's listing chip opens the exact
    // marketplace listing (the import path sets this server-side; the serial
    // path sets it here since core.listingLink doesn't re-seed same-carton).
    const listingUrl = (serialLookup.matchedOrder?.listing_url || '').trim();
    if (listingUrl && !core.listingLink) core.setListingLink(listingUrl);
    if (core.poNumber) return; // never overwrite an operator/Zoho-set PO#
    void core.persistPoNumber(orderNo);
  }, [serialLookup.state, serialLookup.matchedOrder, core.poNumber, core.persistPoNumber, core.listingLink, core.setListingLink]);

  // Reset the auto-bind guard when the line changes.
  useEffect(() => {
    autoBoundOrderRef.current = null;
  }, [row.id]);

  // "File return claim" CTA: ensure the order is paired, then open the claim
  // modal pre-filled with the matched order + serial.
  const handleFileReturnClaim = useCallback(
    (matchedOrder: SerialMatchedOrder | null, explicitSerial?: string) => {
      const orderNo = (matchedOrder?.order_id || '').trim();
      const title = (matchedOrder?.product_title || '').trim();
      const sn = (explicitSerial ?? serialLookup.serial).trim();
      if (orderNo && !core.poNumber) {
        autoBoundOrderRef.current = orderNo;
        void core.persistPoNumber(orderNo);
      }
      const lines = ['Return received and matched to a previously shipped order.'];
      if (title) lines.push(`Item: ${title}.`);
      if (orderNo) lines.push(`Original order: ${orderNo}.`);
      if (matchedOrder?.tracking_number) lines.push(`Shipped tracking: ${matchedOrder.tracking_number}.`);
      if (sn) lines.push(`Serial: ${sn}.`);
      setReturnClaimPrefill(lines.join(' '));
      setClaimModalOpen(true);
    },
    [serialLookup.serial, core.poNumber, core.persistPoNumber],
  );

  // PO-number field commit: first try to IMPORT a sales order by this number
  // (resolves an `orders` row → classifies the carton as a return: type RETURN,
  // listing populated, order# as display rep, off the Unfound queue). If the
  // value isn't a sales order, fall back to the normal PO# persist. So the one
  // field handles both "type a PO#" and "import a return order#".
  const commitPoNumberOrImportOrder = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
      const fallbackPersistPo = () => {
        if (trimmed !== current) void core.persistPoNumber(trimmed);
      };
      if (!trimmed || row.receiving_id == null) {
        fallbackPersistPo();
        return;
      }
      try {
        const res = await fetch('/api/receiving/import-sales-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_number: trimmed,
            receiving_id: row.receiving_id,
            receiving_line_id: row.id,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data.imported) {
          // Reflect the import: type → RETURN (drives the label + listing chip),
          // listing populated, PO editor closed. setReceivingType is the instant
          // local flip; the row patch below carries the durable type/source/PO#/
          // status so every surface re-seeds — listingLink doesn't re-seed from
          // the row, so set it here.
          core.setReceivingType('RETURN');
          const listingUrl = data.matched_order?.listing_url as string | undefined;
          if (listingUrl) core.setListingLink(listingUrl);
          core.setPoEditorOpen(false);
          autoBoundOrderRef.current = trimmed;
          toast.success(`Imported order ${data.matched_order?.order_id ?? trimmed} as a return`);
          // Apply the server's exact line patch optimistically — type→RETURN,
          // listing, carton source flip, order# display rep, and received status
          // all land in one merge. Replaces the old heavy /api/receiving-lines
          // refetch (one of the app's most expensive queries) with a zero-fetch
          // patch, so the workspace flips instantly and durably.
          if (data.line_patch) {
            dispatchUnboxRailLineUpdated(
              data.line_patch as Partial<ReceivingLineRow> & { id: number },
            );
          }
          return;
        }
      } catch {
        /* fall through to a plain PO# persist */
      }
      fallbackPersistPo();
    },
    [
      row.receiving_id,
      row.id,
      row.zoho_purchaseorder_number,
      row.zoho_purchaseorder_id,
      core.persistPoNumber,
      core.setReceivingType,
      core.setListingLink,
      core.setPoEditorOpen,
    ],
  );

  return {
    ...core,
    // condition / qa / disposition
    qa, setQa, disp, setDisp,
    cond, setCond, unitLabelCondition, setUnitLabelCondition, isMultiQtyLine,
    // notes
    notes, setNotes,
    // serial scanning
    serialInput, setSerialInput, serialRef,
    serialAbsent, setSerialAbsent, serialAbsentReason, setSerialAbsentReason,
    headerSerialEdit, setHeaderSerialEdit,
    serialLookup,
    serialSubmitting, submitSerial, enqueueSerial, deleteSerialUnit, replaceSerialUnit, setUnitGrade,
    extraSerials, setExtraSerials, submitExtraSerial,
    // receive / print
    receiving, receiveResult, setReceiveResult, responseExpanded, setResponseExpanded, handleReceive,
    scanValue, labelPayload, runPrintLabel, handlePrintAndReceive,
    // custom label print (Edit on the label preview)
    labelDraftDefaults, buildLabelPayload, applyAndPrintLabel,
    canPrintReview, canReceiveReview, canZohoReceive, isUnfound, combinedReviewDisabled, requireSerialConfirmation,
    receiveMenuLabel, receiveMenuTitle, printReceivePrimaryLabel, splitMenuAriaLabel, splitMenuHoverTitle, printThenReceiveTitle,
    // claim / RETURN flow
    claimModalOpen, setClaimModalOpen, returnClaimPrefill, setReturnClaimPrefill,
    handleFileReturnClaim,
    commitPoNumberOrImportOrder,
    // re-exported helper used by the active-row condition change
    markConditionSet,
  };
}
