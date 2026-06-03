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
  type WheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Barcode,
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
import { ListingUrlChip, TrackingChip, OrderIdChip, TicketChip, getLast4 } from '@/components/ui/CopyChip';
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
import { ConditionPills } from './ConditionPills';
import { markConditionSet } from './ReceivingProgressStepper';
import { SerialCard } from './SerialCard';
import { ReceivingUnitRows, type UnitSerial } from './ReceivingUnitRows';
import { PoLinesAccordion } from './PoLinesAccordion';
import { UnmatchedItemsSection } from './UnmatchedItemsSection';
import { ReceivingClaimModal } from './ReceivingClaimModal';
import { WorkspaceCard } from '@/design-system/components';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { PaneHeaderActionBar, type PaneHeaderActionBarAction } from '@/components/ui/pane-header';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { mobileQrUrl } from '@/lib/barcode-routing';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';
import { formatDatePST, formatDateTimePST, formatTime12hPST } from '@/utils/date';
import { buildReceivingCopyInfo } from '@/utils/copy-all-receiving';
import { copyToClipboard } from '@/utils/_dom';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
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
      <div className="flex items-center justify-between text-label font-semibold text-gray-900">
        <span>{label}</span>
        <span className="tabular-nums text-gray-500">{elapsed}s</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70">
        <div className="recv-indet-bar h-full w-1/3 rounded-full bg-blue-500" />
      </div>
    </div>
  );
}

/** Append a serial_units row to the line's `serials` snapshot (deduped by id + normalized sn). */
function mergeSerialIntoLineSerials(
  prev: ReceivingLineRow['serials'] | undefined,
  serialUnit: { id?: number; serial_number?: string | null } | null | undefined,
): NonNullable<ReceivingLineRow['serials']> {
  if (!serialUnit?.id) return [...(prev ?? [])];
  const sn = String(serialUnit.serial_number ?? '').trim();
  if (!sn) return [...(prev ?? [])];
  const norm = sn.toUpperCase();
  const list = [...(prev ?? [])];
  if (
    list.some(
      (s) =>
        s.id === serialUnit.id ||
        String(s.serial_number || '').trim().toUpperCase() === norm,
    )
  ) {
    return list;
  }
  return [...list, { id: serialUnit.id, serial_number: sn }];
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
  // Effective condition of the currently-selected unit on a multi-qty line.
  // Reported up from ReceivingUnitRows so the label preview/print reflects the
  // selected item rather than the line-level grade. Null on single-qty lines.
  const [unitLabelCondition, setUnitLabelCondition] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [supportNotes, setSupportNotes] = useState('');
  const [trackingEdit, setTrackingEdit] = useState(row.tracking_number || '');
  const [zendesk, setZendesk] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [listingLink, setListingLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const [headerSerialEdit, setHeaderSerialEdit] = useState<{
    id?: number;
    serial_number: string;
    condition_grade?: string | null;
  } | null>(null);
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
  const platformScrollerRef = useRef<HTMLDivElement | null>(null);
  const onPlatformPillsWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = platformScrollerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, []);
  const listingRef = useRef<HTMLInputElement>(null);
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
  const [poEditorOpen, setPoEditorOpen] = useState(() => {
    const poVal = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
    return row.receiving_source === 'unmatched' || !poVal;
  });
  const [poNumberEdit, setPoNumberEdit] = useState(
    (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim(),
  );
  const poInputRef = useRef<HTMLInputElement>(null);
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
    // Re-arm the PO# editor for unmatched / un-bound rows so the operator
    // doesn't have to click the pencil after each switch. Don't auto-close
    // for matched rows — the operator may have deliberately opened it.
    const poVal = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
    if (row.receiving_source === 'unmatched' || !poVal) {
      setPoEditorOpen(true);
    }
  }, [compact, row.id, accordionBootstrap, row.receiving_source, row.zoho_purchaseorder_number, row.zoho_purchaseorder_id]);

  useEffect(() => {
    setReceivingType(row.receiving_type || 'PO');
    setQa(!row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status);
    setDisp(!row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code);
    setCond(row.condition_grade || 'USED_A');
    // Clear the per-unit label override on line switch — the new line's
    // ReceivingUnitRows (if multi-qty) re-reports its selection on mount.
    setUnitLabelCondition(null);
    setTrackingEdit(row.tracking_number || '');
    setPoNumberEdit((row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim());
  }, [row.id, row.qa_status, row.disposition_code, row.condition_grade, row.tracking_number, row.receiving_type, row.zoho_purchaseorder_number, row.zoho_purchaseorder_id]);

  /**
   * Save the operator-typed PO# to the carton AND every existing
   * receiving_line for it. /api/receiving/[id] auto-flips
   * `receiving.source` 'unmatched' → 'zoho_po' on a non-null PO# write,
   * so the carton drops off the Unfound queue. Fanning out to lines
   * means mark-received-po + line lookups + the PO accordion all see
   * the link without waiting for a refresh round-trip.
   */
  const persistPoNumber = useCallback(
    async (nextRaw: string) => {
      if (row.receiving_id == null) return;
      const next = String(nextRaw || '').trim();
      try {
        const res = await fetch(`/api/receiving/${row.receiving_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zoho_purchaseorder_number: next || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          toast.error(data?.error ?? `PO# save failed (${res.status})`);
          return;
        }
        try {
          const linesRes = await fetch(
            `/api/receiving-lines?receiving_id=${row.receiving_id}`,
          );
          const linesData = await linesRes.json();
          const rows = Array.isArray(linesData?.receiving_lines)
            ? linesData.receiving_lines
            : [];
          await Promise.all(
            rows.map((r: { id?: number }) =>
              r?.id != null
                ? fetch('/api/receiving-lines', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id: r.id,
                      zoho_purchaseorder_number: next || null,
                    }),
                  }).catch(() => null)
                : null,
            ),
          );
        } catch {
          /* line fan-out is best-effort; the carton write is source of truth */
        }
        toast.success(next ? `PO# saved (${next})` : 'PO# cleared');
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        window.dispatchEvent(
          new CustomEvent('receiving-package-updated', {
            detail: {
              receiving_id: row.receiving_id,
              zoho_purchaseorder_number: next || null,
            },
          }),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'PO# save failed');
      }
    },
    [row.receiving_id],
  );

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

  useEffect(() => {
    setHeaderSerialEdit(null);
  }, [row.id]);

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
        // Listing URL: DB column (`receiving.listing_url`) is the source of
        // truth — never overwrite an existing DB value or a per-browser
        // scratch override with the Zoho-parsed value. When both are empty
        // and Zoho has one, set it locally and the debounced PATCH effect
        // will persist it to the DB.
        const currentListing =
          (row.receiving_listing_url || '').trim() || scratch.listing.trim();
        if (!currentListing && lPo) setListingLink(lPo);

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

  // Persist the listing URL to the carton (`receiving.listing_url`) so other
  // surfaces — notably the tech testing workspace running in another browser
  // — see it without re-parsing Zoho PO notes. Debounced so paste-then-type
  // doesn't thrash PATCH. Guard against round-tripping the same value we just
  // hydrated from the DB.
  useEffect(() => {
    if (row.receiving_id == null) return;
    const trimmed = listingLink.trim();
    const dbValue = (row.receiving_listing_url || '').trim();
    if (trimmed === dbValue) return;
    const rid = row.receiving_id;
    const t = window.setTimeout(() => {
      void fetch(`/api/receiving/${rid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_url: trimmed || null }),
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!data?.success) return;
        window.dispatchEvent(new CustomEvent('receiving-package-updated', {
          detail: {
            receiving_id: rid,
            listing_url: (data.receiving?.listing_url as string | null) ?? null,
          },
        }));
      }).catch(() => {
        /* silent — scratch keeps the value locally until next attempt */
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [listingLink, row.receiving_id, row.receiving_listing_url]);

  // Keep this inspector in sync when the platform is changed elsewhere
  // (top PO card, another open inspector for the same receiving row).
  useEffect(() => {
    if (row.receiving_id == null) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        receiving_id?: number;
        source_platform?: string | null;
        support_notes?: string | null;
        listing_url?: string | null;
      }>).detail;
      if (!detail || detail.receiving_id !== row.receiving_id) return;
      if (detail.source_platform !== undefined) {
        setSourcePlatform((detail.source_platform || '').toLowerCase());
      }
      if (detail.support_notes !== undefined) {
        setSupportNotes(detail.support_notes || '');
      }
      if (detail.listing_url !== undefined) {
        setListingLink(detail.listing_url || '');
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

  // Parent list (table / sibling accordion) may have stale `row.serials` —
  // it's fetched on a different cadence than the per-line workspace. Pull
  // fresh serials whenever the active line changes so SerialCard's chips +
  // "X/Y SCANNED" tally always agree with what the DB has for this line.
  useEffect(() => {
    void refreshLineWithSerials();
  }, [refreshLineWithSerials]);

  const submitSerial = useCallback(async (raw?: string, conditionGrade?: string | null) => {
    const serial = (raw ?? serialInput).trim();
    if (!serial || !row.receiving_id || serialSubmitting) return;
    setSerialSubmitting(true);
    try {
      // Serials are sidecar metadata: scanning attaches a serial_unit (the item
      // identity + its condition) to the line. Unlimited per line — a unit may
      // carry several serials. It does NOT change quantity_received or stock;
      // those are owned by the PO line item via the Receive action.

      const postScan = async () => {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: row.receiving_id,
            receiving_line_id: row.id,
            serial_number: serial,
            staff_id: Number(staffId),
            // Per-unit grade (multi-qty rows stamp each scan with the grade
            // chosen for that slot). Omitted for the single-block path.
            condition_grade: conditionGrade ?? undefined,
          }),
        });
        const json = await res.json().catch(() => null);
        return { res, data: json };
      };

      const { res, data } = await postScan();

      if (!res.ok || !data?.success) {
        toast.error(data?.error || `Scan failed (${res.status})`);
        return;
      }

      // Same serial already on this line — friendly no-op.
      if (data.already_attached) {
        toast.info(`Already added — ${serial}`);
        return;
      }

      if (data.line_state && typeof data.line_state.id === 'number') {
        setSerialInput('');
        dispatchLineUpdated({
          id: data.line_state.id,
          serials: mergeSerialIntoLineSerials(row.serials, data.serial_unit),
        });
        window.dispatchEvent(new CustomEvent('receiving-serial-scanned', {
          detail: {
            line_id: row.id,
            serial_unit: data.serial_unit,
            is_return: !!data.is_return,
          },
        }));
        setTimeout(() => serialRef.current?.focus(), 40);
        void refreshLineWithSerials();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error scanning serial');
    } finally {
      setSerialSubmitting(false);
    }
  }, [
    serialInput,
    row.receiving_id,
    row.id,
    row.quantity_expected,
    row.quantity_received,
    staffId,
    serialSubmitting,
    refreshLineWithSerials,
    row.serials,
  ]);

  const submitExtraSerial = useCallback(async (idx: number) => {
    const serial = (extraSerials[idx] ?? '').trim();
    if (!serial) return;
    await submitSerial(serial);
    setExtraSerials((xs) => xs.filter((_, j) => j !== idx));
  }, [extraSerials, submitSerial]);

  // Remove a single serial_unit from the line (X / Delete on a chip or unit
  // row). Shared by the single-block adder and the multi-qty unit rows.
  const deleteSerialUnit = useCallback(
    async (serialUnitId: number) => {
      if (serialUnitId == null) return;
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_unit_id: serialUnitId,
          receiving_line_id: row.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not remove serial');
        return;
      }
      toast.success('Serial removed');
      // Removing a serial is metadata-only — quantity_received is unchanged.
      await refreshLineWithSerials();
    },
    [row.id, refreshLineWithSerials],
  );

  // Replace a serial in place (typo fix): delete then re-scan, preserving the
  // unit's condition grade so the corrected serial keeps its grade.
  const replaceSerialUnit = useCallback(
    async (original: { id: number; serial_number: string; condition_grade?: string | null }, nextSerial: string) => {
      if (original.id == null) return;
      const next = (nextSerial ?? '').trim();
      if (!next || next === original.serial_number) return;
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_unit_id: original.id,
          receiving_line_id: row.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not replace serial');
        return;
      }
      await submitSerial(next, original.condition_grade ?? null);
    },
    [row.id, submitSerial],
  );

  // Persist a per-unit condition grade on an already-scanned serial_unit via
  // the dedicated grade endpoint (writes serial_units.condition_grade +
  // GRADED audit). 409 means "no change" — silently ignored.
  const setUnitGrade = useCallback(
    async (serialUnitId: number, grade: string) => {
      try {
        const res = await fetch(`/api/serial-units/${serialUnitId}/grade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_grade: grade }),
        });
        if (res.status === 409) return;
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          toast.error(data?.error || 'Could not set unit condition');
          return;
        }
        await refreshLineWithSerials();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Condition save failed');
      }
    },
    [refreshLineWithSerials],
  );

  const handleReceive = useCallback(
    (receiveIntent: 'zoho_receive' | 'scan_only' = 'zoho_receive') => {
      if (receiveInFlightRef.current) return;
      if (row.receiving_id == null) {
        toast.error('Cannot receive — link this item to a shipment first.', {
          description: 'Scan tracking or use lookup so this line has a receiving (package) id.',
          duration: 6000,
        });
        return;
      }
      receiveInFlightRef.current = true;
      const startedAt = Date.now();
      // Stable per-click id used as both the Idempotency-Key header and the
      // body's client_event_id so api_idempotency_responses replays the
      // cached response on retry / double-click instead of re-running the
      // receive flow (which would double-call Zoho).
      const clientEventId = randomId();
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
          // Circuit-breaker pre-check: if Zoho is in cooldown, bail with a
          // specific "retry in Ns" message instead of firing the receive
          // (which would either skip Zoho silently or wait for the
          // background after() to fail). Only relevant for the zoho_receive
          // intent — scan_only doesn't touch Zoho. The check is best-effort
          // and never blocks the receive on its own failure.
          if (receiveIntent === 'zoho_receive') {
            try {
              const healthRes = await fetch('/api/zoho/health', {
                signal: AbortSignal.timeout(3_000),
              });
              const healthData = await healthRes.json().catch(() => null);
              const circuit = healthData?.zoho?.circuit as
                | { isOpen?: boolean; retryAfterMs?: number; consecutiveFailures?: number }
                | undefined;
              if (circuit?.isOpen) {
                const secs = Math.max(1, Math.ceil((circuit.retryAfterMs ?? 0) / 1000));
                toast.error(`Zoho cooldown — retry in ~${secs}s.`, {
                  id: toastId,
                  description: `Circuit breaker open after ${circuit.consecutiveFailures ?? 0} recent Zoho failures. The PO will NOT be marked received until Zoho recovers.`,
                  duration: 7000,
                });
                setLastReceiveResponse({
                  at: Date.now(),
                  durationMs: Date.now() - startedAt,
                  httpStatus: 0,
                  ok: false,
                  body: { skip_reason: 'zoho_circuit_open', circuit },
                });
                setResponseExpanded(true);
                return;
              }
            } catch {
              /* health check itself failed — fall through; the real
                 receive call below surfaces any genuine error */
            }
          }

          const perLineNotes = notes.trim() || null;

          const markRes = await fetch('/api/receiving/mark-received-po', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': clientEventId,
            },
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
              client_event_id: clientEventId,
            }),
            // Hard ceiling so a server-side hang can never re-pin the
            // loading toast. The handler returns optimistically within a
            // few seconds; anything past 30s is a real failure and the
            // operator should retry — the same Idempotency-Key replays
            // the cached response if the server actually did complete.
            signal: AbortSignal.timeout(30_000),
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
                  pending?: boolean;
                  rate_limited?: boolean;
                  error?: string | null;
                  skip_reason?: string | null;
                  results?: Array<{ purchaseorder_id?: string; receive_id: string | null; error: string | null; error_kind?: string | null }>;
                }
              | undefined;
            if (zoho?.attempted) {
              // Optimistic flow: server already committed locally; Zoho sync
              // is running in the background. UI shows immediate success;
              // any Zoho-side failure surfaces via the receiving-logs
              // realtime channel and a follow-up refresh.
              if (zoho.pending) {
                toast.success('Marked as received — Zoho sync in progress', {
                  id: toastId,
                  duration: 4500,
                });
                setResponseExpanded(false);
              } else if (zoho.rate_limited) {
                toast.error('Zoho daily API quota exhausted — PO was NOT marked received in Zoho. Lines stay in Scanned until Zoho succeeds.', {
                  id: toastId,
                  description: 'Wait for the daily reset or reduce other Zoho-touching workflows for now.',
                  duration: 8000,
                });
                setResponseExpanded(true);
              } else if (!zoho.ok) {
                // Treat "already received in Zoho" as success — Zoho is ahead
                // of us, local SoT now matches.
                const alreadyReceived = /already\s+created\s+a\s+receive\s+for\s+all\s+the\s+items/i.test(
                  String(zoho.error || ''),
                );
                if (alreadyReceived) {
                  toast.success('Already marked as received in Zoho', {
                    id: toastId,
                    description: 'Local state now matches the Zoho dashboard.',
                    duration: 5000,
                  });
                  setResponseExpanded(false);
                } else {
                  toast.error(`Zoho receive failed: ${zoho.error || 'unknown error'}`, {
                    id: toastId,
                    duration: 6000,
                  });
                  setResponseExpanded(true);
                }
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
                  description: 'Sync with Zoho first (refresh icon) to link this package to a PO.',
                  duration: 7000,
                });
                setResponseExpanded(true);
              }
            }
          }

          window.dispatchEvent(new CustomEvent('receiving-entry-added'));
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));

          // Fire-and-forget refresh AFTER the toast has settled. The
          // /api/receiving-lines query can run 10–30s under load and used
          // to be awaited inline, which pinned "Receiving in Zoho…" on
          // screen for the full statement_timeout window even when the
          // receive itself had already succeeded. The receiving-logs
          // realtime channel and the usav-refresh-data event above
          // reconcile the row independently if this refresh is slow.
          if (markRes.ok) {
            void (async () => {
              try {
                const linesRes = await fetch(
                  `/api/receiving-lines?receiving_id=${row.receiving_id}&include=serials`,
                  { signal: AbortSignal.timeout(15_000) },
                );
                const lineData = await linesRes.json();
                const rows = Array.isArray(lineData?.receiving_lines) ? lineData.receiving_lines : [];
                for (const r of rows) {
                  dispatchLineUpdated(r as ReceivingLineRow);
                }
              } catch { /* table may still reflect partial state — realtime channel reconciles */ }
            })();
          }
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

  const recordedSerials = row.serials ?? [];

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
          {/* Utility toolbar — refresh + share / audit / copy + prev/next.
              Single consolidated row above the Staff card; backed by the
              shared PaneHeaderActionBar so this shape stays consistent with
              the rest of the detail-pane surfaces. */}
          <PaneHeaderActionBar
            actions={[
              {
                key: 'refresh',
                label: 'Refresh',
                icon: <RefreshCw className={`h-3.5 w-3.5 ${zohoSyncing ? 'animate-spin' : ''}`} />,
                onClick: syncWithZoho,
                disabled: zohoSyncing,
                title: 'Sync with Zoho by tracking number',
                ariaLabel: 'Refresh line from Zoho',
              },
              {
                key: 'share',
                label: 'Share',
                icon: <Link2 className="h-3.5 w-3.5" />,
                onClick: () => void handleShare(),
                disabled: cartonActionsDisabled,
                title: 'Copy link to open this package on Receiving',
                ariaLabel: 'Share receiving link',
              },
              {
                key: 'audit',
                label: 'Audit',
                icon: <Info className="h-3.5 w-3.5" />,
                onClick: () => setAuditOpen(true),
                disabled: cartonActionsDisabled,
                title: 'Audit log (inventory events)',
                ariaLabel: 'View audit log',
              },
              {
                key: 'copy',
                label: 'Copy',
                icon: <Copy className={`h-3.5 w-3.5 ${copyingAll ? 'animate-pulse' : ''}`} />,
                onClick: () => void handleCopyAll(),
                disabled: cartonActionsDisabled || copyingAll,
                title: 'Copy package + PO details to clipboard',
                ariaLabel: 'Copy all receiving details',
              },
              {
                key: 'open-zoho',
                label: 'Zoho',
                icon: <ExternalLink className="h-3.5 w-3.5" />,
                onClick: () => {
                  // Right-pane Zoho viewer (ZohoSplitPane) listens for this
                  // event and slides in. Never opens a new browser window —
                  // browser tabs get an "Open externally" link inside the
                  // pane instead. Keeps the operator's flow in one window.
                  window.dispatchEvent(
                    new CustomEvent('open-zoho-pane', {
                      detail: {
                        poId: String(row.zoho_purchaseorder_id || '').trim(),
                        poNumber: String(row.zoho_purchaseorder_number || '').trim(),
                      },
                    }),
                  );
                },
                disabled: cartonActionsDisabled,
                title: 'Open this PO in Zoho (right pane)',
                ariaLabel: 'Open in Zoho',
              },
            ] satisfies PaneHeaderActionBarAction[]}
            status={
              zohoSyncing
                ? 'Syncing'
                : (saving || platformSaving)
                ? 'Saving'
                : undefined
            }
            onPrev={() => window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'prev' }))}
            onNext={() => window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'next' }))}
            prevTitle="Previous recent line"
            nextTitle="Next recent line"
          />

          {/* Photos + Claim + shipment context (listing, PO#, tracking,
              platform + type pills) share one WorkspaceCard so the operator
              sees a single bordered surface. */}
          <WorkspaceCard bodyClassName="px-0 py-0">
            <ReceivingCartonStaffDropdown
              receivingId={row.receiving_id}
              staffId={staffId}
              onMakeClaim={() => setClaimModalOpen(true)}
            />
            {/* Padding + top rule separate the photo strip from chips; keeps
                pill focus rings from clipping vs a tight body. */}
            <div className="space-y-2 border-t border-gray-100 px-4 pt-2 pb-3">
            <div className="flex min-w-0 flex-col gap-y-1">
              {/* Chip row uses items-center so listing URL chip, PO chip,
                  and tracking chip share the same vertical baseline
                  regardless of their internal height differences.

                  Layout decisions:
                  - Listing chip is hidden when the URL is empty AND the
                    editor isn't open — unmatched cartons have no listing
                    until a PO# binds them, so the empty chip is just
                    noise.
                  - When PO# editor is open AND the listing chip is gone,
                    the PO# input promotes from a compact chip+pencil to
                    a full-width inline `SearchBar` that fills the freed
                    flex slot. That's the "scan/type a PO#" call-to-action
                    for unmatched cartons. The below-row PO# editor is
                    skipped in that case (avoids the duplicate input). */}
              {(() => {
                const poVal = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
                const showListing = listingLink.trim().length > 0 || listingEditorOpen;
                const inlinePoInput = poEditorOpen && !showListing;
                return (
                  <div className="flex min-w-0 items-center gap-2">
                    {showListing ? (
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
                    ) : null}
                    {zendeskTrimmed ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <TicketChip value={zendeskTrimmed} display={zendeskChipDisplay} />
                        {zendeskHref ? (
                          <a
                            href={zendeskHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open Zendesk ticket"
                            title="Open in Zendesk"
                            className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {inlinePoInput ? (
                      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
                        <div className="group min-w-0 flex-1">
                          <SearchBar
                            value={poNumberEdit}
                            onChange={setPoNumberEdit}
                            onSearch={(v) => {
                              const trimmed = v.trim();
                              const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
                              if (trimmed !== current) {
                                void persistPoNumber(trimmed);
                              }
                            }}
                            inputRef={poInputRef}
                            placeholder="Enter PO# to bind this carton (e.g. PO-1234)"
                            variant="blue"
                            size="compact"
                            hideUnderline
                            pasteOnlyTrailing
                            className="w-full"
                          />
                          <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                        </div>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <OrderIdChip
                          value={poVal}
                          display={poVal ? getLast4(poVal) : '----'}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setPoEditorOpen((v) => {
                              const next = !v;
                              if (next) queueMicrotask(() => poInputRef.current?.focus());
                              return next;
                            });
                          }}
                          aria-expanded={poEditorOpen}
                          aria-label={poEditorOpen ? 'Collapse PO# editor' : 'Edit PO#'}
                          title={poEditorOpen ? 'Done editing PO#' : 'Edit PO#'}
                          className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
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
                          <span className="shrink-0 rounded bg-slate-200/90 px-1 py-px text-eyebrow font-black tabular-nums text-slate-700">
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
                );
              })()}

              {(() => {
                // The PO# editor is rendered inline in the chip row above
                // when the listing slot is free — so this below-row block
                // would render a duplicate input. Skip the PO# block (and
                // the whole wrapper, if nothing else is open) in that case.
                const poBelow =
                  poEditorOpen &&
                  (listingLink.trim().length > 0 || listingEditorOpen);
                const anyBelow = trackingEditorsOpen || listingEditorOpen || poBelow;
                if (!anyBelow) return null;
                return (
                  <div className="mt-2 space-y-2.5 border-t border-slate-100 pt-2">
                    {poBelow ? (
                      <div>
                        <span className={`${FLOW_SECTION_LABEL} mb-1 leading-none`}>PO number</span>
                        <div className="group">
                          <SearchBar
                            value={poNumberEdit}
                            onChange={setPoNumberEdit}
                            onSearch={(v) => {
                              const trimmed = v.trim();
                              const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
                              if (trimmed !== current) {
                                void persistPoNumber(trimmed);
                              }
                            }}
                            inputRef={poInputRef}
                            placeholder="PO-1234"
                            variant="blue"
                            size="compact"
                            hideUnderline
                            pasteOnlyTrailing
                            className="w-full"
                          />
                          <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                        </div>
                      </div>
                    ) : null}
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
                );
              })()}
            </div>

            {/* Platform (left, scrolls) + Type (right). */}
            <div className="flex min-w-0 flex-nowrap items-center gap-3">
              <div
                aria-disabled={row.receiving_id == null || undefined}
                className={`min-w-0 flex-1 overflow-hidden ${row.receiving_id == null ? 'pointer-events-none opacity-50' : ''}`}
              >
                <div
                  ref={platformScrollerRef}
                  onWheel={onPlatformPillsWheel}
                  role="radiogroup"
                  aria-label="Source platform"
                  className="-mx-1 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div className="flex w-max items-center gap-1.5">
                  {/* Synthesized 'Unfound' pill — only for unmatched cartons,
                      auto-active until the operator picks a real platform.
                      Front-end only: never written to source_platform. */}
                  {row.receiving_source === 'unmatched' ? (() => {
                    const isActive = !sourcePlatform;
                    return (
                      <button
                        key="unfound"
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => {
                          setSourcePlatform('');
                          void savePlatform('');
                        }}
                        title="No Zoho PO matched this carton"
                        className={`inline-flex h-8 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors ${
                          isActive
                            ? 'border-amber-600 bg-amber-500 text-white'
                            : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        Unfound
                      </button>
                    );
                  })() : null}
                  {(['ebay', 'goodwill', 'amazon', 'aliexpress', 'walmart', 'ecwid', 'other'] as const)
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
                          className={`inline-flex h-8 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors ${
                            isActive
                              ? 'border-blue-600 bg-blue-600 text-white'
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
              <span className="h-6 w-px shrink-0 self-center bg-slate-200" aria-hidden />
              <div className="shrink-0 text-right">
                <div
                  role="radiogroup"
                  aria-label="Receiving type"
                  className="flex flex-wrap items-center justify-end gap-1.5"
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
                          className={`inline-flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors ${
                            isActive
                              ? 'border-blue-600 bg-blue-600 text-white'
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
                sourcePlatformHint={sourcePlatform || undefined}
                receivingTypeHint={receivingType}
                listingUrlHint={listingLink || undefined}
              />
            ) : (
              <PoLinesAccordion
                receivingId={row.receiving_id}
                activeLineId={row.id}
                activeConditionOverride={isMultiQtyLine ? (unitLabelCondition ?? cond) : cond}
                activeSerialActions={{
                  editingSerialId: headerSerialEdit?.id ?? null,
                  onEdit: (s) => setHeaderSerialEdit(s),
                  onDelete: (s) => {
                    if (s.id == null) return;
                    if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                    if (headerSerialEdit?.id === s.id) setHeaderSerialEdit(null);
                    void deleteSerialUnit(s.id);
                  },
                }}
                activeRowSlot={({ serials }) => (
                  <div className="space-y-3">
                    {(row.quantity_expected ?? 0) > 1 ? (
                      // Multi-qty same-product line: split into one selectable
                      // row per physical unit, each with its own condition grade
                      // and serial (divided by a thin line). The selected unit's
                      // grade is reported up via onActiveConditionChange so the
                      // header badge + label preview track that unit.
                      <ReceivingUnitRows
                        lineId={row.id}
                        saved={serials as UnitSerial[]}
                        quantityExpected={row.quantity_expected ?? 1}
                        lineCondition={cond}
                        disabled={!row.receiving_id}
                        isSubmitting={serialSubmitting}
                        serialEditTarget={
                          headerSerialEdit?.id != null ? (headerSerialEdit as UnitSerial) : null
                        }
                        onAddSerial={(sn, grade) => submitSerial(sn, grade)}
                        onDeleteSerial={(id) => {
                          if (!window.confirm('Remove this serial?')) return;
                          void deleteSerialUnit(id);
                        }}
                        onReplaceSerial={(original, next) => void replaceSerialUnit(original, next)}
                        onSetUnitGrade={(id, grade) => setUnitGrade(id, grade)}
                        onActiveConditionChange={setUnitLabelCondition}
                      />
                    ) : (
                      // Single-qty line (incl. a PARTS product carrying several
                      // part-serials under one unit): one condition picker + a
                      // flat serial list.
                      <>
                        <ConditionPills
                          value={cond}
                          onChange={(next) => {
                            setCond(next);
                            markConditionSet(row.id);
                            void patch({ condition_grade: next });
                          }}
                        />
                        <SerialCard
                          key={`serial-card-${row.id}`}
                          saved={serials}
                          expected={row.quantity_expected ?? null}
                          isSubmitting={serialSubmitting}
                          disabled={!row.receiving_id}
                          embedded
                          showSavedChips={false}
                          editingSerial={headerSerialEdit}
                          onEditingSerialChange={setHeaderSerialEdit}
                          onAdd={(sn) => submitSerial(sn, cond)}
                          onReplaceSerial={(original, nextSerial) => {
                            if (original.id == null) return;
                            void replaceSerialUnit(
                              {
                                id: original.id,
                                serial_number: original.serial_number,
                                condition_grade: original.condition_grade,
                              },
                              nextSerial,
                            );
                          }}
                          onDeleteSerial={(s) => {
                            if (s.id == null) return;
                            if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                            void deleteSerialUnit(s.id);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              />
            )
          ) : null}

          {/* Notes card — standalone so the operator can leave context next
              to the photos + chips without it nesting inside the active PO
              row. Saves on blur (same contract SerialCard used). */}
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
            <label
              htmlFor={`po-item-notes-${row.id}`}
              className="block text-eyebrow font-black uppercase tracking-widest text-gray-500"
            >
              Notes
            </label>
            <textarea
              id={`po-item-notes-${row.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (row.notes || '')) void patch({ notes });
              }}
              rows={2}
              placeholder="PO-line notes (saved on off click)"
              className="mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-caption font-medium leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            />
          </section>

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
                  onBlur={() => void saveZendeskTicket()}
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
                {zendeskTicketUrl(zendesk) ? (
                  <a
                    href={zendeskTicketUrl(zendesk)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Zendesk"
                    className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-blue-600 transition-colors hover:bg-blue-50"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
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
                className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1 text-caption font-medium leading-snug text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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

      {(() => {
        const techTheme = row.assigned_tech_id != null
          ? stationThemeColors[getStaffThemeById(row.assigned_tech_id)]
          : null;
        return (
          <StickyActionBar
            primaryFullWidth
            primary={{
              label: printReceivePrimaryLabel,
              onClick: () => void handlePrintAndReceive(),
              disabled: combinedReviewDisabled,
              title: printThenReceiveTitle,
              icon: <Printer className="h-4 w-4 shrink-0" />,
              toneClasses: {
                bg: techTheme?.bg ?? 'bg-emerald-600',
                hover: techTheme?.hover ?? 'hover:bg-emerald-700',
              },
              menuLabel: splitMenuAriaLabel,
              menuTitle: splitMenuHoverTitle,
              menu: [
                {
                  label: 'Print only',
                  icon: <Printer className="h-3.5 w-3.5 shrink-0" />,
                  onClick: () => runPrintLabel(),
                  disabled: !canPrintReview,
                },
                {
                  label: 'Mark as scanned',
                  icon: <Clipboard className="h-3.5 w-3.5 shrink-0" />,
                  onClick: () => void handleReceive('scan_only'),
                  disabled: !canReceiveReview,
                  title: 'Save quantities as Scanned only; skip Zoho purchase receive (no print)',
                },
                {
                  label: receiveMenuLabel,
                  icon: <PackageCheck className="h-3.5 w-3.5 shrink-0" />,
                  onClick: () => void handleReceive('zoho_receive'),
                  disabled: !canReceiveReview,
                  title: row.receiving_id == null ? 'Line must be linked to a shipment' : undefined,
                },
              ],
            }}
          />
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
