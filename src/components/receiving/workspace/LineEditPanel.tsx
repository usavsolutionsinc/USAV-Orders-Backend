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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import {
  Barcode,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ClipboardList,
  Copy,
  ExternalLink,
  Info,
  Link2,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  ShoppingCart,
  X,
} from '@/components/Icons';
import { toast } from '@/lib/toast';
import { receivingLabelPoCornerDisplay } from '@/lib/print/printReceivingLabel';
import { ListingUrlChip, TrackingChip, OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { ReceivingCartonStaffDropdown } from '@/components/sidebar/receiving/ReceivingCartonStaffDropdown';
import { FlowSection } from './FlowSection';
import {
  printReceivingLabel,
  type ReceivingLabelPayload,
} from './receiving-label-helpers';
import { ReceivingPoLabelPreview } from './ReceivingPoLabelPreview';
import { ReceivingProductLabelPreview } from './ReceivingProductLabelPreview';
import { ReceiveResponsePanel } from './ReceiveResponsePanel';
import { ReceivingAuditModal } from './ReceivingAuditModal';
import { ReceivingContextCard } from './ReceivingContextCard';
import { ConditionPills } from './ConditionPills';
import { SerialCard } from './SerialCard';
import { PoLinesAccordion } from './PoLinesAccordion';
import { ReceivingClaimModal } from './ReceivingClaimModal';
import { WorkspaceCard } from '@/design-system/components';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { mobileQrUrl } from '@/lib/barcode-routing';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';
import { formatDatePST, formatDateTimePST, formatTime12hPST } from '@/utils/date';
import { buildReceivingCopyInfo } from '@/utils/copy-all-receiving';
import { copyToClipboard } from '@/utils/_dom';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import {
  CONDITION_OPTS,
  COND_LABEL,
} from '@/components/station/receiving-constants';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  parseSerialFromLineDescription,
  parseZendeskListingFromPoNotes,
} from '@/lib/zoho-po-prefill';
import {
  RETURN_PLATFORM_LABELS,
  SOURCE_PLATFORM_LABELS,
  SOURCE_PLATFORM_OPTS,
  detectPlatformFromUrl,
  RECEIVING_TYPE_OPTS,
  INPUT_CLASS,
  TYPE_PRODUCT_TITLE_CLASS,
  TYPE_PRODUCT_TITLE_COMPACT_CLASS,
  TYPE_SECTION_TITLE_CLASS,
  TYPE_FIELD_LABEL_CLASS,
  TYPE_HEADER_SUMMARY_CLASS,
  TYPE_INPUT_INLINE_CLASS,
  FLOW_SECTION_BTN_CLASS,
  FLOW_SECTION_TITLE_CLASS,
  FLOW_SECTION_SUMMARY_CLASS,
  FLOW_SECTION_LABEL,
  FLOW_SECTION_SUMMARY_SEP_CLASS,
  RECEIVING_SCAN_RULE_LINE_CLASS,
  RECEIVING_TRAIL_SLOT_CLASS,
  RECEIVING_TRAIL_BTN_CLASS,
  TRACKING_REMOVE_BTN_CLASS,
  TRACKING_ADD_BTN_CLASS,
  TRACKING_ROW_LEADING_ICON_CLASS,
  RECEIVING_CHIP_EDIT_BTN_CLASS,
  FLOW_SECTION_TONE_STYLES,
  RECEIVING_LINE_DETAILS_STORAGE_KEY,
  readReceivingLineDetailsScratch,
  writeReceivingLineDetailsScratch,
  parseReceivingPackage,
  mapApiLineToPoSummary,
  platformLabel,
  formatPackageUnboxDate,
  resolvePoScanValue,
  conditionShort,
  randomId,
  listingUrlForOpen,
  listingLinkPreview,
  receivingShareUrl,
  type PoLineSummary,
  type ReceivingPackageMeta,
  type PoContext,
  type FlowSectionTone,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

/**
 * Sticky progress card shown in the bottom-right toast while the Receive →
 * Zoho roundtrip is in flight. Renders an indeterminate bar (CSS keyframes
 * live in globals.css under `.recv-indet-bar`) and an elapsed-seconds
 * counter so the operator knows the request is still alive even when Zoho
 * is slow.
 */
function ReceiveProgressToast({ startedAt, intent }: { startedAt: number; intent: 'zoho_receive' | 'scan_only' }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const label = intent === 'scan_only' ? 'Marking as scanned…' : 'Receiving in Zoho…';
  return (
    <div className="flex min-w-[260px] flex-col gap-2">
      <div className="flex items-center justify-between text-[12px] font-semibold text-gray-900">
        <span>{label}</span>
        <span className="tabular-nums text-gray-500">{elapsed}s</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70">
        <div className="recv-indet-bar h-full w-1/3 rounded-full bg-blue-500" />
      </div>
    </div>
  );
}

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
  onClose: () => void;
}) {
  const [receivingType, setReceivingType] = useState(row.receiving_type || 'PO');
  const [qa, setQa] = useState(
    !row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status,
  );
  const [disp, setDisp] = useState(
    !row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code,
  );
  const [cond, setCond] = useState(row.condition_grade || 'USED_A');
  const [notes, setNotes] = useState('');
  const [supportNotes, setSupportNotes] = useState('');
  const [trackingEdit, setTrackingEdit] = useState(row.tracking_number || '');
  const [zendesk, setZendesk] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [listingLink, setListingLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  // Receive runs as a fire-and-forget background task (Zoho roundtrip can
  // take many seconds). The button does NOT visually lock — progress is
  // surfaced in a sticky bottom-right toast. A ref guards against accidental
  // double-clicks while a request for this line is still in flight.
  const receiveInFlightRef = useRef(false);
  const [sourcePlatform, setSourcePlatform] = useState<string>('');
  const [platformSaving, setPlatformSaving] = useState(false);
  type FlowSecKey = 'shipment' | 'item' | 'support';
  // All three sections expanded by default — including Support — so the user
  // sees every field at a glance without an extra click. Per-section color
  // tinting (see FlowSection `tone` prop) keeps them visually distinct.
  const [flowOpen, setFlowOpen] = useState<Record<FlowSecKey, boolean>>(() => ({
    shipment: true,
    item: true,
    support: true,
  }));
  // Claim modal — opened from PhotosCard's "Make a claim" CTA. The modal
  // creates a Zendesk ticket via /api/receiving/zendesk-claim and auto-pops
  // the returned TK # back into the Support FlowSection's existing zendesk
  // field via dispatchLineUpdated.
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  // Support FlowSection is hidden by default — it surfaces only after a
  // claim is filed (so the operator can review the auto-populated ZD ticket
  // #) or when an existing zendesk_ticket/support note is already saved on
  // the line. Keeps the default workspace lean: condition + serial + photos
  // are what the operator sees first.
  const [showSupportOverride, setShowSupportOverride] = useState(false);
  const [extraTrackings, setExtraTrackings] = useState<string[]>([]);
  const [extraSerials, setExtraSerials] = useState<string[]>([]);
  const [zohoSyncing, setZohoSyncing] = useState(false);
  /**
   * Last response from POST /api/receiving/mark-received-po. Surfaced in the
   * UI directly below the print preview so operators can see exactly why a
   * Zoho receive succeeded, was skipped (missing zoho ids), or failed
   * (rate_limit, circuit_open, api, other). No more silent failures.
   */
  type ReceiveResponseRecord = {
    at: number;
    /** ms wall-clock from POST → response */
    durationMs: number;
    httpStatus: number;
    ok: boolean;
    /** Raw JSON body returned from the API. */
    body: unknown;
    /** Network-level error message (thrown before/after the fetch). */
    networkError?: string;
  };
  const [lastReceiveResponse, setLastReceiveResponse] =
    useState<ReceiveResponseRecord | null>(null);
  const [responseExpanded, setResponseExpanded] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);
  const listingRef = useRef<HTMLInputElement>(null);
  /** Full editors for tracking rows — collapsed when carton already has numbers (expand to edit). */
  const [trackingEditorsOpen, setTrackingEditorsOpen] = useState(true);
  /** Full listing SearchBar — collapsed by default; pencil expands to paste/edit. */
  const [listingEditorOpen, setListingEditorOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);

  const persistZendeskRef = useRef(zendesk);
  const persistListingRef = useRef(listingLink);
  const persistExtraTrackingsRef = useRef(extraTrackings);
  persistZendeskRef.current = zendesk;
  persistListingRef.current = listingLink;
  persistExtraTrackingsRef.current = extraTrackings;

  const toggleFlow = useCallback((key: FlowSecKey) => {
    setFlowOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

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
    // Keep every section expanded across row changes — including Support —
    // so the user never has to re-open them after switching lines.
    setFlowOpen({ shipment: true, item: true, support: true });
    // Reset Support visibility when the operator switches lines — the new
    // line's own zendesk/notes will re-reveal it if needed.
    setShowSupportOverride(false);
  }, [compact, row.id, accordionBootstrap]);

  useEffect(() => {
    setReceivingType(row.receiving_type || 'PO');
    setQa(!row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status);
    setDisp(!row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code);
    setCond(row.condition_grade || 'USED_A');
    setTrackingEdit(row.tracking_number || '');
  }, [row.id, row.qa_status, row.disposition_code, row.condition_grade, row.tracking_number, row.receiving_type]);

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
      setTrackingEditorsOpen(!(row.tracking_number || '').trim());
      return;
    }
    const d = readReceivingLineDetailsScratch(row.receiving_id);
    setZendesk(d.zendesk);
    setListingLink(d.listing);
    const extras = d.extra_trackings.length > 0 ? d.extra_trackings : [];
    setExtraTrackings(extras);
    const primaryTr = (row.tracking_number || '').trim();
    const hasExtras = extras.some((t) => t.trim().length > 0);
    setTrackingEditorsOpen(!primaryTr && !hasExtras);
  }, [row.receiving_id, row.tracking_number]);

  /** Listing chip/editor: always start minimized when the selected line or carton changes. */
  useLayoutEffect(() => {
    setListingEditorOpen(false);
  }, [row.id, row.receiving_id]);

  useLayoutEffect(() => {
    setNotes(row.notes ?? '');
  }, [row.id, row.notes]);

  useEffect(() => {
    setSupportNotes(row.receiving_support_notes || '');
  }, [row.id, row.receiving_id, row.receiving_support_notes]);

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

  // Prefill Zendesk, listing, and serial from Zoho PO notes + line description.
  useEffect(() => {
    const poId = (row.zoho_purchaseorder_id || '').trim();
    if (!poId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(poId)}`,
        );
        const data = await res.json();
        if (cancelled || !data?.success || !data.purchaseorder) return;

        const po = data.purchaseorder as {
          notes?: string | null;
          line_items?: Array<{ line_item_id?: string; description?: string | null }>;
        };

        const rid = row.receiving_id;
        const scratch = readReceivingLineDetailsScratch(rid);
        const { zendesk: zPo, listing: lPo } = parseZendeskListingFromPoNotes(po.notes ?? '');
        if (!scratch.zendesk.trim() && zPo) setZendesk(zPo);
        if (!scratch.listing.trim() && lPo) setListingLink(lPo);

        const lineItemId = (row.zoho_line_item_id || '').trim();
        if (!lineItemId || !Array.isArray(po.line_items)) return;
        const li = po.line_items.find(
          (l) => String(l.line_item_id || '').trim() === lineItemId,
        );
        // Local serials (from serial_units via receiving-lines `include=serials`)
        // win over the Zoho PO description. Only fall back to Zoho when the
        // line has no local serial on file yet.
        const hasLocalSerial = (row.serials ?? []).some((s) => (s.serial_number || '').trim());
        if (hasLocalSerial) return;
        const sn = parseSerialFromLineDescription(li?.description ?? null);
        if (sn) setSerialInput(sn);
      } catch {
        /* Zoho unavailable — fields stay empty */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [row.id, row.receiving_id, row.zoho_purchaseorder_id, row.zoho_line_item_id]);

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

  // Load the parent receiving row's source_platform so the dropdown reflects
  // the current shipment-level override (platform is per-carton, not per-line).
  useEffect(() => {
    if (row.receiving_id == null) {
      setSourcePlatform('');
      return;
    }
    let cancelled = false;
    fetch(`/api/receiving-lines?receiving_id=${row.receiving_id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const pkg = parseReceivingPackage(data?.receiving_package);
        setSourcePlatform((pkg?.source_platform || '').toLowerCase());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [row.receiving_id]);

  const savePlatform = useCallback(async (next: string) => {
    if (row.receiving_id == null) return;
    setPlatformSaving(true);
    try {
      await fetch(`/api/receiving/${row.receiving_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: next || null }),
      });
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: row.receiving_id, source_platform: next || null },
      }));
    } catch {
      /* silent */
    } finally {
      setPlatformSaving(false);
    }
  }, [row.receiving_id]);

  // Auto-detect platform from the listing URL when the operator hasn't set
  // one yet. Only fires when sourcePlatform is empty so we never clobber a
  // manual choice. Debounced lightly so paste-then-type doesn't thrash the
  // PATCH endpoint.
  useEffect(() => {
    if (row.receiving_id == null) return;
    if (sourcePlatform) return;
    const detected = detectPlatformFromUrl(listingLink);
    if (!detected) return;
    const t = window.setTimeout(() => {
      setSourcePlatform(detected);
      void savePlatform(detected);
    }, 350);
    return () => window.clearTimeout(t);
  }, [listingLink, sourcePlatform, row.receiving_id, savePlatform]);

  const saveSupportNotes = useCallback(async () => {
    if (row.receiving_id == null) return;
    const trimmed = supportNotes.trim();
    const prev = (row.receiving_support_notes || '').trim();
    if (trimmed === prev) return;
    try {
      const res = await fetch(`/api/receiving/${row.receiving_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ support_notes: trimmed || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) return;
      const nextSn = (data.receiving?.support_notes as string | null) ?? null;
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: row.receiving_id, support_notes: nextSn },
      }));
    } catch {
      /* silent */
    }
  }, [row.receiving_id, row.receiving_support_notes, supportNotes]);

  // Keep this inspector in sync when the platform is changed elsewhere
  // (top PO card, another open inspector for the same receiving row).
  useEffect(() => {
    if (row.receiving_id == null) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        receiving_id?: number;
        source_platform?: string | null;
        support_notes?: string | null;
      }>).detail;
      if (!detail || detail.receiving_id !== row.receiving_id) return;
      if (detail.source_platform !== undefined) {
        setSourcePlatform((detail.source_platform || '').toLowerCase());
      }
      if (detail.support_notes !== undefined) {
        setSupportNotes(detail.support_notes || '');
      }
    };
    window.addEventListener('receiving-package-updated', handler);
    return () => window.removeEventListener('receiving-package-updated', handler);
  }, [row.receiving_id]);

  const patch = useCallback(async (fields: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/receiving-lines', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, ...fields }),
      });
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        dispatchLineUpdated(data.receiving_line);
      }
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }, [row.id]);

  const refreshLineWithSerials = useCallback(async () => {
    try {
      const res = await fetch(`/api/receiving-lines?id=${row.id}&include=serials`);
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        dispatchLineUpdated(data.receiving_line as ReceivingLineRow);
      }
    } catch {
      /* silent */
    }
  }, [row.id]);

  const submitSerial = useCallback(async (raw?: string) => {
    const serial = (raw ?? serialInput).trim();
    if (!serial || !row.receiving_id || serialSubmitting) return;
    setSerialSubmitting(true);
    try {
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: row.receiving_id,
          receiving_line_id: row.id,
          serial_number: serial,
          staff_id: Number(staffId),
        }),
      });
      const data = await res.json();
      if (data?.success && data.line_state && typeof data.line_state.id === 'number') {
        setSerialInput('');
        const ls = data.line_state;
        dispatchLineUpdated({
          id: ls.id,
          quantity_received: ls.quantity_received,
          quantity_expected: ls.quantity_expected,
          workflow_status: ls.workflow_status ?? undefined,
        });
        window.dispatchEvent(new CustomEvent('receiving-serial-scanned', {
          detail: {
            line_id: row.id,
            new_qty: ls.quantity_received,
            serial_unit: data.serial_unit,
            is_return: !!data.is_return,
            is_complete: !!ls.is_complete,
          },
        }));
        setTimeout(() => serialRef.current?.focus(), 40);
        void refreshLineWithSerials();
      }
    } catch { /* silent */ } finally {
      setSerialSubmitting(false);
    }
  }, [serialInput, row.receiving_id, row.id, staffId, serialSubmitting, refreshLineWithSerials]);

  const submitExtraSerial = useCallback(async (idx: number) => {
    const serial = (extraSerials[idx] ?? '').trim();
    if (!serial) return;
    await submitSerial(serial);
    setExtraSerials((xs) => xs.filter((_, j) => j !== idx));
  }, [extraSerials, submitSerial]);

  const handleReceive = useCallback(
    (receiveIntent: 'zoho_receive' | 'scan_only' = 'zoho_receive') => {
      if (receiveInFlightRef.current) return;
      if (row.receiving_id == null) {
        toast.error('Cannot receive — link this item to a shipment first.', {
          description: 'Scan tracking or use lookup so this line has a receiving (carton) id.',
          duration: 6000,
        });
        return;
      }
      receiveInFlightRef.current = true;
      const startedAt = Date.now();
      // Sticky progress toast (bottom-right via the global <Toaster>). Same
      // id is reused on settle so success/error replaces the loading card
      // in place instead of stacking another card on top.
      const toastId = toast.loading(
        <ReceiveProgressToast startedAt={startedAt} intent={receiveIntent} />,
        { duration: Infinity, closeButton: false },
      );

      // Fire-and-forget — operator keeps working while Zoho responds. The
      // print popup was opened synchronously by the caller (runPrintLabel)
      // before we got here, so no await blocks it.
      void (async () => {
        try {
          const perLineNotes = notes.trim() || null;

          const markRes = await fetch('/api/receiving/mark-received-po', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receiving_id: row.receiving_id,
              receiving_line_id: row.id,
              receive_intent: receiveIntent,
              qa_status: qa,
              disposition_code: disp,
              condition_grade: cond,
              serial_number: serialInput.trim() || undefined,
              zendesk_ticket: zendesk.trim() || undefined,
              listing_link: listingLink.trim() || undefined,
              notes: perLineNotes || undefined,
              staff_id: Number(staffId),
            }),
          });
          const markData = await markRes.json().catch(() => null);

          const respRecord: ReceiveResponseRecord = {
            at: Date.now(),
            durationMs: Date.now() - startedAt,
            httpStatus: markRes.status,
            ok: markRes.ok && Boolean(markData?.success),
            body: markData,
          };
          setLastReceiveResponse(respRecord);

          if (markRes.ok) {
            try {
              const linesRes = await fetch(`/api/receiving-lines?receiving_id=${row.receiving_id}`);
              const lineData = await linesRes.json();
              const rows = Array.isArray(lineData?.receiving_lines) ? lineData.receiving_lines : [];
              for (const r of rows) {
                dispatchLineUpdated(r as ReceivingLineRow);
              }
            } catch { /* table may still reflect partial state */ }
          }

          if (!markRes.ok || !markData?.success) {
            console.error('receiving/mark-received-po failed', { status: markRes.status, error: markData?.error });
            toast.error(markData?.error || `Receive failed (HTTP ${markRes.status})`, {
              id: toastId,
              duration: 6000,
            });
            setResponseExpanded(true);
          } else {
            const zoho = markData?.zoho as
              | {
                  attempted?: number;
                  ok?: boolean;
                  rate_limited?: boolean;
                  error?: string | null;
                  skip_reason?: string | null;
                  results?: Array<{ purchaseorder_id?: string; receive_id: string | null; error: string | null; error_kind?: string | null }>;
                }
              | undefined;
            if (zoho?.attempted) {
              if (zoho.rate_limited) {
                toast.error('Zoho daily API quota exhausted — PO was NOT marked received in Zoho. Lines stay in Scanned until Zoho succeeds.', {
                  id: toastId,
                  description: 'Wait for the daily reset or reduce other Zoho-touching workflows for now.',
                  duration: 8000,
                });
                setResponseExpanded(true);
              } else if (!zoho.ok) {
                toast.error(`Zoho receive failed: ${zoho.error || 'unknown error'}`, {
                  id: toastId,
                  duration: 6000,
                });
                setResponseExpanded(true);
              } else if (zoho.skip_reason === 'zoho_already_fully_received') {
                toast.success('Zoho already shows this PO as fully received.', {
                  id: toastId,
                  description: 'Purchase receive was not needed; inventory matches the dashboard.',
                  duration: 5000,
                });
                setResponseExpanded(false);
              } else {
                toast.success(
                  <div className="flex flex-col gap-1 text-left">
                    <span className="leading-snug">Successfully added SN# & notes to PO item</span>
                    <span className="leading-snug">Successfully marked the PO as Received</span>
                  </div>,
                  { id: toastId, duration: 6000 },
                );
                setResponseExpanded(false);
              }
            } else {
              const skipReason = zoho?.skip_reason;
              if (skipReason === 'scan_only') {
                toast.success('Marked as scanned locally (Zoho not updated). Run Receive when ready to sync inventory.', {
                  id: toastId,
                  duration: 6500,
                });
                setResponseExpanded(false);
              } else if (skipReason === 'zoho_already_fully_received') {
                toast.success('Zoho already shows this PO as fully received.', {
                  id: toastId,
                  description: 'Purchase receive was not needed; inventory matches the dashboard.',
                  duration: 5000,
                });
                setResponseExpanded(false);
              } else if (skipReason === 'no_receiving_lines') {
                toast.message('No receiving lines on this shipment.', { id: toastId, duration: 5000 });
                setResponseExpanded(true);
              } else {
                toast.error('Lines saved locally — Zoho was NOT updated (no PO link found).', {
                  id: toastId,
                  description: 'Sync with Zoho first (refresh icon) to link this carton to a PO.',
                  duration: 7000,
                });
                setResponseExpanded(true);
              }
            }
          }

          window.dispatchEvent(new CustomEvent('receiving-entry-added'));
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        } catch (err) {
          console.error('receiving/mark-received-po threw', err);
          const message = err instanceof Error ? err.message : 'Receive failed';
          toast.error(message, { id: toastId, duration: 6000 });
          setLastReceiveResponse({
            at: Date.now(),
            durationMs: Date.now() - startedAt,
            httpStatus: 0,
            ok: false,
            body: null,
            networkError: message,
          });
          setResponseExpanded(true);
        } finally {
          receiveInFlightRef.current = false;
        }
      })();
    },
    [row.receiving_id, row.id, qa, disp, cond, notes, zendesk, listingLink, serialInput, staffId],
  );

  const poNumber = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const scanValue = poNumber || (row.receiving_id != null ? `RCV-${row.receiving_id}` : '');
  const trackingHint = (row.tracking_number || trackingEdit || '').trim();
  const labelPlatform = sourcePlatform
    ? (SOURCE_PLATFORM_LABELS[sourcePlatform] ?? sourcePlatform)
    : String(receivingType || 'PO').toUpperCase() === 'PICKUP' ? 'Local pickup' : 'Unknown';
  const labelDate = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  const labelPayload: ReceivingLabelPayload = {
    receivingId: row.receiving_id ?? null,
    scanValue,
    platform: labelPlatform,
    zendeskTicket: zendesk.trim() || undefined,
    notes: notes.trim(),
    conditionCode: cond,
    date: labelDate,
  };

  const inboundSummary = (
    <>
      <span className="min-w-0 truncate" title={trackingHint || undefined}>
        {trackingHint ? getLast4(trackingHint) : '—'}
      </span>
      <span className={FLOW_SECTION_SUMMARY_SEP_CLASS} aria-hidden>
        ·
      </span>
      <span className="min-w-0 max-w-full break-words text-right">{labelPlatform}</span>
    </>
  );

  const runPrintLabel = useCallback(() => {
    if (scanValue.trim()) {
      printReceivingLabel(labelPayload);
      return;
    }
    const skuTrim = (row.sku || '').trim();
    if (skuTrim) {
      printProductLabel({
        sku: skuTrim,
        title: row.item_name ?? undefined,
        serialNumber: serialInput.trim() || undefined,
      });
    }
  }, [scanValue, labelPayload, row.sku, row.item_name, serialInput]);

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

  const recordedSerials = row.serials ?? [];

  const listingOpenHref = listingUrlForOpen(listingLink);
  const primaryTrackingTrimmed = trackingEdit.trim();
  const filledExtraTrackingsCount = extraTrackings.filter((t) => t.trim().length > 0).length;
  const listingPreviewLabel = listingLinkPreview(listingLink);

  // Refresh ↔ Zoho. Always searches by tracking# (PO# search is a future upd).
  // Flow:
  //   1. find-po by tracking# — Zoho is the source of truth.
  //   2. Reconcile the line: if Zoho's purchaseorder_id or number differs
  //      from the local line, PATCH /api/receiving-lines. No-op on match.
  //   3. Reconcile the carton (receiving row): PATCH with PO# + tracking#
  //      when `receiving_id` is set. Otherwise fall back to /api/receiving/
  //      lookup-po which creates/links a carton from the tracking#.
  const syncWithZoho = useCallback(async () => {
    if (zohoSyncing) return;
    const tracking = (row.tracking_number || '').trim();
    if (!tracking) return;
    setZohoSyncing(true);
    try {
      const knownPoId = (row.zoho_purchaseorder_id || '').trim();

      // Fast path: PO ID already known — skip the slow find-po search and
      // go straight to the single-PO fetch for notes/listing prefill.
      if (knownPoId) {
        // Re-fetch the line to pick up any server-side changes.
        const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
        const lineData = await lineRes.json();
        if (lineData?.success && lineData.receiving_line) {
          dispatchLineUpdated(lineData.receiving_line as ReceivingLineRow);
        }

        // Fetch full PO for notes → prefill listing / zendesk.
        try {
          const poRes = await fetch(
            `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(knownPoId)}`,
          );
          const poData = await poRes.json();
          if (poData?.success && poData.purchaseorder) {
            const poNotes = (poData.purchaseorder as { notes?: string | null }).notes ?? '';
            const parsed = parseZendeskListingFromPoNotes(poNotes);
            if (!listingLink.trim() && parsed.listing) setListingLink(parsed.listing);
            if (!zendesk.trim() && parsed.zendesk) setZendesk(parsed.zendesk);
          }
        } catch { /* PO fetch failed — fields stay as-is */ }
        return;
      }

      // Slow path: no PO ID yet — search Zoho by tracking number.
      const findRes = await fetch('/api/zoho/find-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking }),
      });
      const findData = await findRes.json();
      const po = findData?.success && findData.matched ? findData.purchase_order : null;

      // Reconcile the line's PO#/number only if Zoho disagrees.
      if (po) {
        const zohoId = (po.zoho_purchaseorder_id || '').trim() || null;
        const zohoNum = (po.zoho_purchaseorder_number || '').trim() || null;
        const localId = (row.zoho_purchaseorder_id || '').trim() || null;
        const localNum = (row.zoho_purchaseorder_number || '').trim() || null;
        const patchBody: Record<string, unknown> = { id: row.id };
        if (zohoId && zohoId !== localId) patchBody.zoho_purchaseorder_id = zohoId;
        if (zohoNum && zohoNum !== localNum) patchBody.zoho_purchaseorder_number = zohoNum;
        if (Object.keys(patchBody).length > 1) {
          await fetch('/api/receiving-lines', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          });
        }
      }

      // Reconcile the carton.
      if (row.receiving_id) {
        if (po) {
          await fetch(`/api/receiving/${row.receiving_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              zoho_purchaseorder_id: po.zoho_purchaseorder_id || null,
              zoho_purchaseorder_number: po.zoho_purchaseorder_number || null,
              reference_number: po.reference_number || tracking,
            }),
          });
        }
      } else {
        await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumber: tracking, staffId: Number(staffId) }),
        });
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      }

      // Re-fetch the line so sidebar + table pick up every change.
      const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
      const lineData = await lineRes.json();
      if (lineData?.success && lineData.receiving_line) {
        dispatchLineUpdated(lineData.receiving_line as ReceivingLineRow);
      }

      // Prefill listing / zendesk from PO notes if still empty.
      const resolvedPoId = (po?.zoho_purchaseorder_id || '').trim();
      if (resolvedPoId) {
        try {
          const poRes = await fetch(
            `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(resolvedPoId)}`,
          );
          const poData = await poRes.json();
          if (poData?.success && poData.purchaseorder) {
            const poNotes = (poData.purchaseorder as { notes?: string | null }).notes ?? '';
            const parsed = parseZendeskListingFromPoNotes(poNotes);
            if (!listingLink.trim() && parsed.listing) setListingLink(parsed.listing);
            if (!zendesk.trim() && parsed.zendesk) setZendesk(parsed.zendesk);
          }
        } catch { /* PO fetch failed — fields stay as-is */ }
      }
    } catch {
      /* silent — user can retry */
    } finally {
      setZohoSyncing(false);
    }
  }, [zohoSyncing, row.id, row.receiving_id, row.tracking_number,
      row.zoho_purchaseorder_id, row.zoho_purchaseorder_number, staffId,
      listingLink, zendesk]);

  // Workspace header's Refresh button dispatches this so we don't need a
  // prop-drilled ref or to lift syncWithZoho up to the workspace.
  useEffect(() => {
    const handler = () => { void syncWithZoho(); };
    window.addEventListener('receiving-workspace-refresh-line', handler);
    return () => window.removeEventListener('receiving-workspace-refresh-line', handler);
  }, [syncWithZoho]);

  const handleShare = useCallback(async () => {
    if (!row.receiving_id) {
      toast.error('No receiving carton linked yet');
      return;
    }
    const url = receivingShareUrl(row.receiving_id, row.id);
    const poLabel = row.zoho_purchaseorder_number || `Carton #${row.receiving_id}`;
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

  const handleCopyAll = useCallback(async () => {
    if (!row.receiving_id) {
      toast.error('No receiving carton linked yet');
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

  const hasItemNav = typeof itemIndex === 'number' && typeof itemTotal === 'number' && itemTotal > 0;
  const itemCountSummary = hasItemNav && (itemTotal ?? 0) > 1 ? `${itemTotal} items` : undefined;
  const cartonActionsDisabled = !row.receiving_id;

  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      {/* Scroll surface — owns the centered hero column. Padding-bottom
          clears the sticky action bar so the last card never hides under it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
          {/* Toolbar — refresh + share / audit / copy + prev/next. Single
              consolidated utility bar above the Staff card; replaces the
              old workspace-header buttons. */}
          <div className="flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white px-3 py-1.5 shadow-sm">
            <button
              type="button"
              onClick={syncWithZoho}
              disabled={zohoSyncing}
              aria-label="Refresh line from Zoho"
              title="Sync with Zoho by tracking number"
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${zohoSyncing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={cartonActionsDisabled}
              aria-label="Share receiving link"
              title="Copy link to open this carton on Receiving"
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Link2 className="h-3.5 w-3.5" />
              Share
            </button>
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              disabled={cartonActionsDisabled}
              aria-label="View audit log"
              title="Audit log (inventory events)"
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Info className="h-3.5 w-3.5" />
              Audit
            </button>
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              disabled={cartonActionsDisabled || copyingAll}
              aria-label="Copy all receiving details"
              title="Copy carton + PO details to clipboard"
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Copy className={`h-3.5 w-3.5 ${copyingAll ? 'animate-pulse' : ''}`} />
              Copy
            </button>
            {(zohoSyncing || saving || platformSaving) && (
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-600" aria-live="polite">
                {zohoSyncing ? 'Syncing' : 'Saving'}
              </span>
            )}
            <div className="flex-1" />
            {/* Prev/Next — wired to the recent rail / history table via
                `receiving-navigate-table`. Lives in this bar (was workspace
                header) so all utility actions are in one row. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'prev' }))}
              aria-label="Previous recent line"
              title="Previous recent line"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'next' }))}
              aria-label="Next recent line"
              title="Next recent line"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Staff · Scanned · Received — sits below the toolbar so the
              operator's first content read is "who did what, when" plus
              the carton's photos + claim trigger. */}
          <WorkspaceCard bodyClassName="px-0 py-0">
            <ReceivingCartonStaffDropdown
              receivingId={row.receiving_id}
              staffId={staffId}
              onMakeClaim={() => setClaimModalOpen(true)}
            />
          </WorkspaceCard>

          {/* Shipment PO — flat WorkspaceCard (no accordion, no left rail).
              Sits ABOVE the item title so tracking + platform + type are
              the operator's first context check. */}
          {/* Body padding bumped (py-4) so the selected pill's outline +
              focus ring aren't clipped by a too-tight card body. */}
          <WorkspaceCard label="Shipment PO" bodyClassName="px-4 py-4">

          <div className="space-y-2.5">
            <div className="flex min-w-0 flex-col gap-y-1">
              {/* Chip row uses items-center so listing URL chip, PO chip,
                  and tracking chip share the same vertical baseline
                  regardless of their internal height differences. */}
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
                  <ListingUrlChip
                    rawUrl={listingLink}
                    openHref={listingOpenHref}
                    previewDisplay={listingPreviewLabel}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setListingEditorOpen((v) => {
                        const next = !v;
                        if (next) queueMicrotask(() => listingRef.current?.focus());
                        return next;
                      });
                    }}
                    aria-expanded={listingEditorOpen}
                    aria-label={listingEditorOpen ? 'Collapse listing URL editor' : 'Edit listing URL'}
                    title={listingEditorOpen ? 'Done editing listing' : 'Edit listing URL'}
                    className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                {/* PO# copy chip — sits between the listing and the tracking
                    so the operator can grab the PO number with one tap. */}
                {(row.zoho_purchaseorder_number || row.zoho_purchaseorder_id) ? (
                  <div className="flex shrink-0 items-center">
                    <OrderIdChip
                      value={String(row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '')}
                      display={getLast4(String(row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || ''))}
                    />
                  </div>
                ) : null}
                <div className="flex shrink-0 items-center gap-1">
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 max-w-full [&_.relative]:max-w-full">
                      <TrackingChip
                        value={primaryTrackingTrimmed}
                        display={getLast4(primaryTrackingTrimmed)}
                        disableCopy={!primaryTrackingTrimmed}
                        width="min-w-0 max-w-full"
                      />
                    </div>
                    {filledExtraTrackingsCount > 0 ? (
                      <span className="shrink-0 rounded bg-slate-200/90 px-1 py-px text-[9px] font-black tabular-nums text-slate-700">
                        +{filledExtraTrackingsCount}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={toggleTrackingEditors}
                      aria-expanded={trackingEditorsOpen}
                      aria-label={trackingEditorsOpen ? 'Collapse tracking editors' : 'Edit tracking numbers'}
                      title={trackingEditorsOpen ? 'Done editing tracking' : 'Edit tracking'}
                      className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {(trackingEditorsOpen || listingEditorOpen) ? (
                <div className="mt-2 space-y-2.5 border-t border-slate-100 pt-2">
                  {trackingEditorsOpen ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>Tracking number</span>
                        <span className={RECEIVING_TRAIL_SLOT_CLASS}>
                          <button
                            type="button"
                            onClick={() =>
                              setExtraTrackings((xs) => (xs.length >= 1 ? xs : [...xs, '']))
                            }
                            disabled={extraTrackings.length >= 1}
                            aria-label="Add second tracking number row"
                            title={
                              extraTrackings.length >= 1
                                ? 'Only one extra tracking row'
                                : 'Add tracking number'
                            }
                            className={TRACKING_ADD_BTN_CLASS}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </span>
                      </div>
                      <div className="group min-w-0">
                        <SearchBar
                          value={trackingEdit}
                          onChange={setTrackingEdit}
                          onSearch={(v) => {
                            const trimmed = v.trim();
                            if (trimmed !== (row.tracking_number || '').trim()) {
                              patch({ zoho_reference_number: trimmed || null });
                            }
                          }}
                          placeholder="Tracking"
                          variant="blue"
                          size="compact"
                          hideUnderline
                          pasteOnlyTrailing
                          leadingIcon={<Barcode className="h-[14px] w-[14px]" />}
                          className="w-full min-w-0"
                        />
                        <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                      </div>
                      {extraTrackings.map((t, i) => (
                        <div key={i} className="group min-w-0">
                          <SearchBar
                            value={t}
                            onChange={(v) =>
                              setExtraTrackings((xs) => xs.map((x, j) => (j === i ? v : x)))
                            }
                            placeholder="Tracking"
                            variant="blue"
                            size="compact"
                            hideUnderline
                            debounceMs={0}
                            pasteOnlyTrailing
                            leadingIcon={<Barcode className="h-[14px] w-[14px]" />}
                            className="w-full min-w-0"
                          />
                          <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                        </div>
                      ))}
                    </>
                  ) : null}
                  {listingEditorOpen ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>Listing URL</span>
                        <span className={RECEIVING_TRAIL_SLOT_CLASS} aria-hidden />
                      </div>
                      <div className="group">
                        <SearchBar
                          value={listingLink}
                          onChange={setListingLink}
                          onClear={() => setListingLink('')}
                          inputRef={listingRef}
                          placeholder="Listing URL"
                          variant="blue"
                          size="compact"
                          hideUnderline
                          leadingIcon={
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                if (listingOpenHref) {
                                  window.open(listingOpenHref, '_blank', 'noopener,noreferrer');
                                }
                              }}
                              disabled={listingOpenHref == null}
                              aria-label="Open listing URL in new tab"
                              title={listingOpenHref ? 'Open link' : 'Enter a valid URL'}
                              className="-m-0.5 rounded p-0.5 text-inherit transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              <ExternalLink className="h-[14px] w-[14px]" />
                            </button>
                          }
                          className="w-full"
                        />
                        <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Platform (left, flexes) + Type (right). Inline pill row —
                no HorizontalButtonSlider so there's no overflow-x-auto
                clipping the active pill's outline at the top/bottom. */}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <div
                aria-disabled={row.receiving_id == null || undefined}
                className={`min-w-0 flex-1 ${row.receiving_id == null ? 'pointer-events-none opacity-50' : ''}`}
              >
                <span className={FLOW_SECTION_LABEL}>Platform</span>
                <div
                  role="radiogroup"
                  aria-label="Source platform"
                  className="mt-1.5 flex flex-wrap items-center gap-1.5"
                >
                  {(['ebay', 'goodwill', 'amazon', 'aliexpress', 'walmart', 'other'] as const)
                    .map((id) => SOURCE_PLATFORM_OPTS.find((o) => o.value === id))
                    .filter((o): o is (typeof SOURCE_PLATFORM_OPTS)[number] => !!o)
                    .map((opt) => {
                      const isActive = (sourcePlatform || '') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          onClick={() => {
                            setSourcePlatform(opt.value);
                            void savePlatform(opt.value);
                          }}
                          className={`inline-flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-[10px] font-black uppercase tracking-wide transition-colors ${
                            isActive
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                </div>
              </div>
              <span className="mt-5 h-6 w-px shrink-0 bg-slate-200" aria-hidden />
              <div className="min-w-0 shrink-0 ml-auto text-right">
                <span className={FLOW_SECTION_LABEL}>Type</span>
                <div
                  role="radiogroup"
                  aria-label="Receiving type"
                  className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5"
                >
                  {RECEIVING_TYPE_OPTS
                    .filter((opt) => opt.value !== 'PICKUP')
                    .map((opt) => {
                      const isActive = receivingType === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          onClick={() => {
                            setReceivingType(opt.value);
                            patch({ receiving_type: opt.value });
                          }}
                          className={`inline-flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-[10px] font-black uppercase tracking-wide transition-colors ${
                            isActive
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
          </WorkspaceCard>

          {/* PO Lines accordion — renders only for multi-line cartons
              (component self-guards on rows.length <= 1). Sits ABOVE the
              product title so the operator picks the right line first,
              then sees its title + critical inputs below. */}
          {row.receiving_id != null ? (
            <PoLinesAccordion receivingId={row.receiving_id} activeLineId={row.id} />
          ) : null}

          {/* Product / item title — flat title-only card. Line N of M lives
              in the PoLinesAccordion above; variant chip + SKU stripped. */}
          <ReceivingContextCard
            row={row}
            lineIndex={itemIndex}
            lineTotal={itemTotal}
          />

          {/* Condition pills — top-of-workspace critical input. Drives the
              same `cond` state used by the (now-removed) Item FlowSection. */}
          <ConditionPills
            value={cond}
            onChange={(next) => {
              setCond(next);
              void patch({ condition_grade: next });
            }}
          />

          {/* Serial scan + notes — co-located so the operator can leave a
              note without leaving the scan path. */}
          <SerialCard
            saved={row.serials ?? []}
            expected={row.quantity_expected ?? null}
            isSubmitting={serialSubmitting}
            disabled={!row.receiving_id}
            onAdd={(sn) => { void submitSerial(sn); }}
            notes={notes}
            onNotesChange={setNotes}
            onNotesBlur={() => {
              if (notes !== (row.notes || '')) void patch({ notes });
            }}
            notesId={`po-item-notes-${row.id}`}
          />

          {/* Photos + Make a Claim are co-located inside the Staff card
              above — no standalone PhotosCard is needed in the column. */}

          {/* Shipment PO moved above (under the ContextCard); Item removed
              entirely as its fields are surfaced as top-of-workspace cards. */}

          {/* ── SUPPORT ──
              Hidden by default. Surfaces when:
                • the operator opens a claim (showSupportOverride flips true), OR
                • a Zendesk ticket / support notes were already saved (so the
                  history of the carton is still reachable on re-open).
              The "Make a claim" flow auto-populates `zendesk` on success, so
              the operator sees the freshly-filed ticket # immediately. */}
          {(showSupportOverride || zendesk.trim() || supportNotes.trim()) ? (
          <WorkspaceCard tone="orange" bodyClassName="px-0 py-0" className="overflow-hidden">
            <FlowSection
              embedded
              title="Support"
              summary={
                zendesk.trim()
                  ? 'Zendesk'
                  : supportNotes.trim()
                    ? 'Notes'
                    : undefined
              }
              open={flowOpen.support}
              onToggle={() => toggleFlow('support')}
              tone="support"
              bodyClassName="px-3 py-3"
            >
          <div className="space-y-2.5">
            <div>
              <span className={FLOW_SECTION_LABEL}>Zendesk</span>
              <div className="mt-1 flex gap-1">
                <input
                  type="text"
                  value={zendesk}
                  onChange={(e) => setZendesk(e.target.value)}
                  placeholder="Ticket # or URL"
                  className={`${INPUT_CLASS} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const t = await navigator.clipboard.readText();
                      if (t) setZendesk(t.trim());
                    } catch { /* */ }
                  }}
                  title="Paste"
                  className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500 transition-colors hover:bg-slate-50"
                >
                  <Clipboard className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div>
              <label htmlFor={`support-notes-${row.receiving_id ?? 'none'}-${row.id}`} className={FLOW_SECTION_LABEL}>
                Support notes
              </label>
              <textarea
                id={`support-notes-${row.receiving_id ?? 'none'}-${row.id}`}
                value={supportNotes}
                onChange={(e) => setSupportNotes(e.target.value)}
                onBlur={() => void saveSupportNotes()}
                disabled={row.receiving_id == null}
                rows={2}
                placeholder={
                  row.receiving_id == null
                    ? 'Link this line to a shipment to save support notes'
                    : 'Ticket context, vendor issues, PO-wide notes…'
                }
                className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium leading-snug text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
          </div>
            </FlowSection>
          </WorkspaceCard>
          ) : null}

          {scanValue || row.sku ? (
            <WorkspaceCard label="Label preview">
              {scanValue ? (
                <ReceivingPoLabelPreview {...labelPayload} embedded />
              ) : row.sku ? (
                <ReceivingProductLabelPreview
                  sku={row.sku}
                  title={row.item_name ?? ''}
                  serialNumber={serialInput.trim()}
                  embedded
                />
              ) : null}
            </WorkspaceCard>
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

      {/* Sticky action bar — pinned to the bottom of the workspace. Hosts
          the existing split-button menu intact (Print only / Mark scanned /
          Receive) so all handlers + keyboard shortcuts continue to fire.
          Color picks up the assigned tech's station theme (same palette
          used elsewhere via `stationThemeColors`) so the operator's eye
          recognizes "this carton belongs to me" at a glance. Falls back to
          emerald when no tech is assigned. */}
      {(() => {
        const techTheme = row.assigned_tech_id != null
          ? stationThemeColors[getStaffThemeById(row.assigned_tech_id)]
          : null;
        const ctaBg = techTheme?.bg ?? 'bg-emerald-600';
        const ctaHover = techTheme?.hover ?? 'hover:bg-emerald-700';
        // Derive a slightly lighter border-divider between the split menu
        // chevron and the main CTA — same hue, lower opacity.
        const ctaDivider = ctaBg.replace('bg-', 'border-').replace('-600', '-500/50').replace('-500', '-400/50').replace('-900', '-700/50');
        return (
      <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className={`relative z-20 flex w-full overflow-visible rounded-xl shadow-sm ${ctaBg}`}>
            <div className="group/split-menu relative flex shrink-0 self-stretch">
              <button
                type="button"
                aria-haspopup="menu"
                aria-label={splitMenuAriaLabel}
                title={splitMenuHoverTitle}
                className={`flex h-auto min-h-[44px] items-center justify-center rounded-l-xl border-r ${ctaDivider} px-3 text-white outline-none transition-colors ${ctaHover} focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2`}
              >
                <ChevronDown className="h-4 w-4 opacity-95" aria-hidden />
              </button>
              <div
                className="
                    invisible absolute left-0 bottom-full z-50 pb-1.5 opacity-0
                    transition-opacity duration-75
                    group-hover/split-menu:pointer-events-auto group-hover/split-menu:visible group-hover/split-menu:opacity-100
                    group-focus-within/split-menu:pointer-events-auto group-focus-within/split-menu:visible group-focus-within/split-menu:opacity-100
                  "
                role="presentation"
              >
                <ul
                  role="menu"
                  aria-label="Single-action review controls"
                  className="min-w-[12rem] rounded-lg border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-slate-200/80"
                >
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={!canPrintReview}
                      onClick={(e) => {
                        e.stopPropagation();
                        runPrintLabel();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Print only
                    </button>
                  </li>
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={!canReceiveReview}
                      title="Save quantities as Scanned only; skip Zoho purchase receive (no print)"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReceive('scan_only');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Clipboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Mark as scanned
                    </button>
                  </li>
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={!canReceiveReview}
                      title={
                        row.receiving_id == null
                          ? 'Line must be linked to a shipment'
                          : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReceive('zoho_receive');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <PackageCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {receiveMenuLabel}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handlePrintAndReceive()}
              disabled={combinedReviewDisabled}
              title={printThenReceiveTitle}
              className={`inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2 rounded-r-xl px-4 py-2 text-[12px] font-black uppercase tracking-wider text-white outline-none transition-colors ${ctaHover} disabled:cursor-not-allowed disabled:opacity-60 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2`}
            >
              <Printer className="h-4 w-4 shrink-0" aria-hidden />
              {printReceivePrimaryLabel}
            </button>
          </div>
        </div>
      </div>
        );
      })()}
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
      onClose={() => setClaimModalOpen(false)}
      onTicketCreated={(tk) => {
        // Auto-populate the Support ZD field — only if empty, so we don't
        // stomp in-flight operator edits. The existing save flow persists it
        // on the next Receive / patch event.
        if (!zendesk.trim()) setZendesk(tk);
        // Reveal the Support card so the operator can verify the
        // freshly-filed ticket # without hunting for a toggle.
        setShowSupportOverride(true);
        // Broadcast so other surfaces (Recent rail, table) can refresh
        // their cached row if they hold a zendesk_ticket field.
        dispatchLineUpdated({ id: row.id, notes: row.notes });
      }}
    />
    </>
  );
}
