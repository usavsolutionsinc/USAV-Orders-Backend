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
import { useSerialLookup } from './SerialMatchResult';
import { PoLinesAccordion } from './PoLinesAccordion';
import { takeSerialEditHandoff } from './serialEditHandoff';
import { UnmatchedItemsSection } from './UnmatchedItemsSection';
import { ReceivingClaimModal } from './ReceivingClaimModal';
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
  parseSerialFromLineDescription,
  parseZendeskListingFromPoNotes,
} from '@/lib/zoho-po-prefill';
import {
  SOURCE_PLATFORM_LABELS,
  readReceivingLineDetailsScratch,
  writeReceivingLineDetailsScratch,
  listingUrlForOpen,
  listingLinkPreview,
  receivingShareUrl,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

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
  const [trackingEdit, setTrackingEdit] = useState(row.tracking_number || '');
  const [zendesk, setZendesk] = useState('');
  const [serialInput, setSerialInput] = useState('');
  // RETURN flow: on serial commit we check the serial against serial_units and
  // surface "Match found" / "No match found" under the scan card. The read runs
  // before the scan upsert (see submitSerial) so it reflects prior inventory,
  // not the row we're about to write.
  const serialLookup = useSerialLookup();
  const [listingLink, setListingLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
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
    setCond(row.condition_grade || 'USED_A');
    // Clear the per-unit label override on line switch — the new line's
    // ReceivingUnitRows (if multi-qty) re-reports its selection on mount.
    setUnitLabelCondition(null);
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
        listing_url?: string | null;
      }>).detail;
      if (!detail || detail.receiving_id !== row.receiving_id) return;
      if (detail.source_platform !== undefined) {
        setSourcePlatform((detail.source_platform || '').toLowerCase());
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

  const refreshLineWithSerials = useCallback(async (lineId: number = row.id) => {
    try {
      const res = await fetch(`/api/receiving-lines?id=${lineId}&include=serials`);
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        // dispatchLineUpdated patches the accordion's matching row, so editing
        // a serial on a non-active sibling refreshes that sibling's chips too.
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

      // RETURN flow: surface whether this serial already exists in our records
      // (a genuine return matches a previously-shipped unit). The lookup MUST
      // run before the upsert below — otherwise it would match the row we're
      // about to write and always report "Match found".
      if (receivingType === 'RETURN') {
        await serialLookup.check(serial);
      }

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
    receivingType,
    serialLookup,
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
    async (serialUnitId: number, lineId: number = row.id) => {
      if (serialUnitId == null) return;
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_unit_id: serialUnitId,
          // Route to the chip's own line — the endpoint only removes a unit
          // that still points at this line, so a sibling's serial would 404
          // if we sent the active row's id.
          receiving_line_id: lineId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not remove serial');
        return;
      }
      toast.success('Serial removed');
      // Removing a serial is metadata-only — quantity_received is unchanged.
      await refreshLineWithSerials(lineId);
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
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <LineEditToolbar
        receivingId={row.receiving_id ?? null}
        zohoSyncing={zohoSyncing}
        busy={saving || platformSaving}
        copyingAll={copyingAll}
        poId={String(row.zoho_purchaseorder_id || '')}
        poNumber={String(row.zoho_purchaseorder_number || '')}
        onRefresh={() => void syncWithZoho()}
        onShare={() => void handleShare()}
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
            onMakeClaim={() => setClaimModalOpen(true)}
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
                activeRowSlot={({ serials }) => (
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
                    onSubmitSerial={(sn, grade) => void submitSerial(sn, grade)}
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

          <LineLabelPreviewCard
            scanValue={scanValue}
            labelPayload={labelPayload}
            sku={row.sku}
            itemName={row.item_name}
            serialNumber={serialInput.trim()}
          />

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
