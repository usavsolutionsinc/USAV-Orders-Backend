'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { Loader2, Printer } from '@/components/Icons';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { OrderIdChip, TrackingChip, ListingUrlChip, getLast4 } from '@/components/ui/CopyChip';
import { PoLinesAccordion } from '@/components/receiving/workspace/PoLinesAccordion';
import { InlineSerialAdder } from '@/components/receiving/workspace/InlineSerialAdder';
import { UnmatchedItemsSection } from '@/components/receiving/workspace/UnmatchedItemsSection';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingAuditModal } from '@/components/receiving/workspace/ReceivingAuditModal';
import { PaneHeaderActionBar, type PaneHeaderActionBarAction } from '@/components/ui/pane-header';
import { Copy, Info } from '@/components/Icons';
import { buildReceivingCopyInfo } from '@/utils/copy-all-receiving';
import { copyToClipboard } from '@/utils/_dom';
import { ReceivingCartonStaffDropdown } from '@/components/sidebar/receiving/ReceivingCartonStaffDropdown';
import { LabelPreviewCard } from '@/components/labels/LabelPreviewCard';
import {
  TestingStatusPills,
  verdictToReceivingLinePatch,
  workflowToVerdict,
  type TestingVerdict,
} from '@/components/receiving/workspace/TestingStatusPills';
import {
  dispatchLineUpdated,
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  readSelectLineDetail,
  readReceivingLineDetailsScratch,
  listingUrlForOpen,
  listingLinkPreview,
  type ReceivingSelectLineDetail,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { buildUnitPayload, printProductLabels } from '@/lib/print/printProductLabel';
import { normalizeSku } from '@/utils/sku';

interface Props {
  staffId: string;
  /** When set, drives the rail-side highlighted line. */
  selectedLineId: number | null;
  onSelectedLineChange: (id: number | null) => void;
}

interface NextIdResponse {
  ok: boolean;
  unitId: string;
  gtin: string | null;
  qrUrl: string | null;
  error?: string;
}

const PRINT_QTY_OPTIONS = [1, 2, 3, 4, 5] as const;

/**
 * Mirrors the receiving page's restore key but on its own namespace — testers
 * and receivers often work different lines at once on the same browser, so
 * sharing the key would yank one role's view into the other's.
 */
const LAST_TESTING_LINE_KEY = 'usav:testing:last-line-id';

/**
 * Right-pane workspace for the Testing sub-page.
 *
 * Composition mirrors {@link LineEditPanel} but with the testing flow swapped
 * in for receive: the carton header card, PO Items accordion, serial card,
 * and label preview live in the same column. Where LineEditPanel renders
 * `ConditionPills` inside the active PO row, we render `TestingStatusPills`
 * (Pass / Test Again / Testing Failed) instead. Where LineEditPanel's sticky
 * action is "Print · receive", we ship "Pass + Print" — print N tested-OK
 * labels and patch the line `workflow_status='PASSED'`.
 */
export function TechTestingWorkspace({ staffId, selectedLineId, onSelectedLineChange }: Props) {
  const [row, setRow] = useState<ReceivingLineRow | null>(null);
  const [verdict, setVerdict] = useState<TestingVerdict | null>(null);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const [printQty, setPrintQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  /**
   * Per-line verdict state for unmatched cartons (no single "active line").
   * Keyed by receiving_lines.id; falls back to {@link verdict} only for the
   * matched-PO path where the workspace owns the active line directly.
   */
  const [verdictByLine, setVerdictByLine] = useState<Record<number, TestingVerdict>>({});
  const [auditOpen, setAuditOpen] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);

  const lastSelectedRef = useRef<number | null>(null);

  // Listen for `receiving-select-line` — same event the rail + scan resolver
  // fire. Mirrors the contract LineEditPanel observes from the receiving page.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ReceivingSelectLineDetail>).detail;
      const { row: next } = readSelectLineDetail(detail);
      if (next) {
        setRow(next);
        onSelectedLineChange(next.id);
        lastSelectedRef.current = next.id;
        try {
          window.localStorage.setItem(LAST_TESTING_LINE_KEY, String(next.id));
        } catch {
          /* private mode / quota — non-fatal */
        }
      } else {
        setRow(null);
        onSelectedLineChange(null);
        lastSelectedRef.current = null;
      }
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [onSelectedLineChange]);

  // Restore the last opened testing line on mount. Same two-tier fallback as
  // the receiving page: localStorage first, then the most-recent line from
  // the rail's dataset. Dispatched through `receiving-select-line` so the
  // existing handler above + the sidebar's rail highlight both pick it up.
  const rowRef = useRef<ReceivingLineRow | null>(null);
  rowRef.current = row;
  useEffect(() => {
    let cancelled = false;

    const fetchById = async (id: number): Promise<ReceivingLineRow | null> => {
      try {
        const res = await fetch(
          `/api/receiving-lines?id=${id}&include=serials`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        if (data?.success && data.receiving_line) {
          return data.receiving_line as ReceivingLineRow;
        }
        return null;
      } catch {
        return null;
      }
    };

    const fetchMostRecent = async (): Promise<ReceivingLineRow | null> => {
      try {
        const res = await fetch(
          `/api/receiving-lines?limit=1&offset=0&view=all&include=serials`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        return rows[0] ?? null;
      } catch {
        return null;
      }
    };

    void (async () => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(LAST_TESTING_LINE_KEY);
      } catch {
        /* private mode — fall through to recent */
      }
      const storedId = Number(stored);
      if (Number.isFinite(storedId) && storedId > 0) {
        const restored = await fetchById(storedId);
        if (cancelled) return;
        if (restored) {
          if (rowRef.current) return;
          dispatchSelectLine(restored);
          return;
        }
        try {
          window.localStorage.removeItem(LAST_TESTING_LINE_KEY);
        } catch {
          /* non-fatal */
        }
      }
      if (cancelled || rowRef.current) return;
      const recent = await fetchMostRecent();
      if (cancelled || !recent || rowRef.current) return;
      dispatchSelectLine(recent);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic updates from elsewhere (rail patches, sibling switch, etc.)
  useEffect(() => {
    const handler = (event: Event) => {
      const patch = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!patch || typeof patch.id !== 'number') return;
      setRow((current) =>
        current && current.id === patch.id
          ? ({ ...current, ...patch } as ReceivingLineRow)
          : current,
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  // Bootstrap verdict + notes from the row each time it changes.
  useEffect(() => {
    if (!row) {
      setVerdict(null);
      setNotes('');
      setPrintQty(1);
      return;
    }
    setVerdict(workflowToVerdict(row.workflow_status));
    setNotes(row.notes ?? '');
    setPrintQty(1);
  }, [row?.id, row?.workflow_status, row?.notes]);

  // Refresh row's serials whenever it changes — table-side caches are slower.
  const refreshLineWithSerials = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/receiving-lines?id=${id}&include=serials`);
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        setRow((current) =>
          current && current.id === id
            ? ({ ...current, ...data.receiving_line } as ReceivingLineRow)
            : current,
        );
        dispatchLineUpdated(data.receiving_line as ReceivingLineRow);
      }
    } catch {
      /* silent — next manual action will retry */
    }
  }, []);

  useEffect(() => {
    if (row?.id) void refreshLineWithSerials(row.id);
  }, [row?.id, refreshLineWithSerials]);

  // ── Patch helpers ─────────────────────────────────────────────────────────
  const patchLine = useCallback(
    async (fields: Record<string, unknown>) => {
      if (!row) return;
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
          setRow((current) =>
            current && current.id === row.id
              ? ({ ...current, ...data.receiving_line } as ReceivingLineRow)
              : current,
          );
        }
      } catch (err) {
        toast.error('Save failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setSaving(false);
      }
    },
    [row],
  );

  // ── Verdict change ────────────────────────────────────────────────────────
  // Verdict change only patches the line. Filing a claim is a deliberate
  // separate action via the carton-level Claim button, not an automatic
  // side-effect of picking Testing Failed.
  const handleVerdictChange = useCallback(
    (next: TestingVerdict) => {
      setVerdict(next);
      const patch = verdictToReceivingLinePatch(next);
      void patchLine(patch);
    },
    [patchLine],
  );

  // ── Per-line serial mgmt ─────────────────────────────────────────────────
  // Both helpers take an explicit `lineId` so callers from inside the
  // PO Items accordion can target the row they're rendered for, not the
  // workspace's notion of the active line. (Today they're always the same
  // — the adder mounts in `activeRowSlot` — but this keeps the contract
  // honest and lets future surfaces add serials to siblings.)
  const submitSerial = useCallback(
    async (lineId: number, raw: string) => {
      if (!row?.receiving_id) return;
      const serial = (raw ?? '').trim();
      if (!serial || serialSubmitting) return;
      setSerialSubmitting(true);
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: row.receiving_id,
            receiving_line_id: lineId,
            serial_number: serial,
            staff_id: Number(staffId),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          toast.error(data?.error || `Scan failed (${res.status})`);
          return;
        }
        if (data.already_received) {
          toast.info(`Already received — ${serial}`);
          return;
        }
        if (data.supplemental) {
          // PO line was already at expected qty — the serial is still saved
          // (serial_units + tech_serial_numbers) but the count / ledger don't
          // move. Receiving and testing share this behavior.
          toast.success(`Extra serial logged — ${serial}`, {
            description: 'Beyond expected qty: no stock change.',
          });
        }
        // Refresh the active row only when it matches; sibling rows pick the
        // update up via the `receiving-line-updated` event the API emits.
        if (lineId === row.id) await refreshLineWithSerials(row.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Network error scanning serial');
      } finally {
        setSerialSubmitting(false);
      }
    },
    [row, staffId, serialSubmitting, refreshLineWithSerials],
  );

  const deleteSerial = useCallback(
    async (lineId: number, serialUnitId: number) => {
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serial_unit_id: serialUnitId,
            receiving_line_id: lineId,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not remove serial');
          return;
        }
        toast.success('Serial removed');
        if (row && lineId === row.id) await refreshLineWithSerials(row.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Remove failed');
      }
    },
    [row, refreshLineWithSerials],
  );

  // Replace a saved serial in-place — DELETE the old row, POST the new one.
  // Mirrors LineEditPanel's contract so the SerialChipWithMenu Edit menu
  // behaves identically across receiving + testing.
  const replaceSerial = useCallback(
    async (lineId: number, originalSerialUnitId: number, nextSerial: string) => {
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serial_unit_id: originalSerialUnitId,
            receiving_line_id: lineId,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not replace serial');
          return;
        }
        await submitSerial(lineId, nextSerial);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Replace failed');
      }
    },
    [submitSerial],
  );

  // ── Pass + Print ───────────────────────────────────────────────────────────
  /**
   * Allocate the next unit id for the current SKU. Same atomic per-(sku,year)
   * sequence the receiving + product label flows use.
   */
  const allocateUnitId = useCallback(async (sku: string): Promise<NextIdResponse | null> => {
    try {
      const res = await fetch('/api/units/next-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: normalizeSku(sku) }),
      });
      const data = (await res.json()) as NextIdResponse;
      if (!res.ok || !data?.ok) {
        toast.error(`Can't allocate unit id: ${data?.error || res.status}`);
        return null;
      }
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'next-id failed');
      return null;
    }
  }, []);

  /** Issue tested-OK labels: mints one unit id per label, writes serial_units + LABELED events, prints. */
  const issueAndPrintLabels = useCallback(
    async (count: number): Promise<boolean> => {
      if (!row || !row.sku) {
        toast.error('Line has no SKU — cannot issue label');
        return false;
      }
      // Round-robin over saved physical serials so multi-serial lines get a
      // distinct physical SN baked into each label. If a line has 3 serials
      // and the tech prints 5, the last 2 cycle back to serial #1 and #2.
      // If the line has no serials at all, every label just encodes the
      // unit id (label still prints, but DataMatrix carries only the SKU).
      const physicalSerials = (row.serials ?? [])
        .map((s) => (s.serial_number || '').trim())
        .filter(Boolean);

      const unitIds: string[] = [];
      const qrPayloads: Array<string | null> = [];
      let gtin: string | null = null;

      for (let i = 0; i < count; i++) {
        const allocation = await allocateUnitId(row.sku);
        if (!allocation) return false;
        unitIds.push(allocation.unitId);
        qrPayloads.push(allocation.qrUrl);
        gtin = allocation.gtin ?? gtin;

        const serialForThisLabel =
          physicalSerials.length > 0 ? physicalSerials[i % physicalSerials.length] : null;

        // Persist this unit to the canonical pipeline so it shows up in
        // Recently Printed, tech_serial_numbers, and inventory_events
        // (same call MultiSkuSnBarcode makes on click — keeps audit honest).
        const payload = buildUnitPayload({
          sku: allocation.unitId,
          serialNumber: serialForThisLabel,
          qrPayload: allocation.qrUrl,
          gtin: allocation.gtin,
        });
        try {
          await fetch('/api/post-multi-sn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sku: allocation.unitId,
              productSku: row.sku,
              unitId: allocation.unitId,
              gtin: allocation.gtin ?? undefined,
              qrPayload: payload.value,
              symbology: payload.symbology,
              serialNumbers: serialForThisLabel ? [serialForThisLabel] : [],
              notes,
              condition: row.condition_grade || 'USED_A',
              printClass: 'print',
            }),
          });
        } catch (err) {
          console.warn('post-multi-sn failed (label still prints):', err);
        }
      }

      printProductLabels({
        sku: row.sku,
        title: row.item_name ?? undefined,
        serialNumbers: unitIds,
        gtin: gtin ?? undefined,
        qrPayloads,
      });
      return true;
    },
    [row, allocateUnitId, notes],
  );

  // ── Copy all ──────────────────────────────────────────────────────────────
  /**
   * Fetches the full carton + line set and copies a human-readable summary
   * to the clipboard. Re-uses receiving's {@link buildReceivingCopyInfo}
   * formatter so what gets pasted into Slack/Zendesk matches what the
   * receiver would have copied.
   */
  const handleCopyAll = useCallback(async () => {
    if (!row || !row.receiving_id) return;
    setCopyingAll(true);
    try {
      const res = await fetch(`/api/receiving/${row.receiving_id}`, { cache: 'no-store' });
      const data = await res.json();
      const lines = data?.success && Array.isArray(data.lines) ? data.lines : [];
      const text = buildReceivingCopyInfo({
        carton: data?.success ? data.receiving : null,
        lines,
        scratch: { zendesk: '', listing: '', extraTrackings: [] },
        currentLine: row,
        shareUrl: '',
      });
      const ok = await copyToClipboard(text);
      if (ok) toast.success('Copied testing details');
      else toast.error('Could not copy to clipboard');
    } catch {
      toast.error('Failed to build copy text');
    } finally {
      setCopyingAll(false);
    }
  }, [row]);

  /**
   * After a Pass+Print finishes, find the next sibling line on the same
   * carton whose workflow_status isn't terminal yet (DONE / PASSED) and
   * select it so the tech can keep scanning verdict pills without clicking
   * back into the rail. Returns null when the carton has no more open lines.
   */
  const findNextOpenSibling = useCallback(
    async (currentRow: ReceivingLineRow): Promise<ReceivingLineRow | null> => {
      if (currentRow.receiving_id == null) return null;
      try {
        const res = await fetch(
          `/api/receiving-lines?receiving_id=${currentRow.receiving_id}&include=serials`,
        );
        const data = await res.json();
        const siblings: ReceivingLineRow[] = data?.receiving_lines ?? [];
        const open = siblings.filter((s) => {
          if (s.id === currentRow.id) return false;
          const v = String(s.workflow_status || '').toUpperCase();
          return v !== 'DONE' && v !== 'PASSED';
        });
        return open[0] ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const handlePrimary = useCallback(async () => {
    if (!row) return;
    // Only Pass prints. Test Again + Testing Failed never print — the
    // pill change has already patched the line. Print is a one-tap finalizer.
    if (verdict !== 'PASS') {
      toast.info(
        verdict === 'TESTING_FAILED'
          ? 'Use the Claim button to file a ticket. No label will print on Fail.'
          : 'Mark Pass to print a tested-OK label.',
      );
      return;
    }
    setIsPrinting(true);
    try {
      const ok = await issueAndPrintLabels(printQty);
      if (!ok) return;
      // Final receiving-line state: PASSED + DONE so it falls off the testing
      // queue and into the packer queue (workflow_status DONE is the v1 signal).
      await patchLine({
        workflow_status: 'DONE',
        qa_status: 'PASSED',
        disposition_code: 'ACCEPT',
        notes: notes.trim() || null,
      });
      toast.success(`Printed ${printQty} tested-OK label${printQty === 1 ? '' : 's'}`);

      // Auto-advance to the next open sibling on the same carton. The rail
      // + PO Items accordion both react to receiving-select-line, so this
      // keeps the tech's scan flow rolling without an explicit click.
      const next = await findNextOpenSibling(row);
      if (next) {
        dispatchSelectLine(next);
      } else {
        toast.success('Carton complete — all items tested', { duration: 2500 });
      }
    } finally {
      setIsPrinting(false);
    }
  }, [row, verdict, printQty, notes, issueAndPrintLabels, patchLine, findNextOpenSibling]);

  // Memoize the live preview payload so the DataMatrix only re-renders
  // when something it actually encodes changes.
  const previewPayload = useMemo(() => {
    if (!row?.sku) return null;
    const physicalSerial = (row.serials ?? [])
      .map((s) => (s.serial_number || '').trim())
      .find(Boolean) ?? null;
    return buildUnitPayload({
      sku: row.sku,
      serialNumber: physicalSerial,
      qrPayload: null,
      gtin: null,
    });
  }, [row?.sku, row?.serials]);

  // Mount-time restore handles the no-row case (localStorage → most-recent),
  // so there's no operator-facing empty prompt — just a quiet holding area
  // until the restored row lands. Operator can use the sidebar rail at any
  // time to pick a different line.
  if (!row) {
    return <div className="h-full w-full bg-gray-50" aria-hidden />;
  }

  // ── Workspace ─────────────────────────────────────────────────────────────
  const poNumber = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const tracking = (row.tracking_number || '').trim();
  // Listing URL: prefer the DB-persisted carton column (`receiving.listing_url`)
  // so the URL surfaces across browsers/devices without re-pinging Zoho. Fall
  // back to the per-browser localStorage scratch for cartons that pre-date the
  // column being populated. Receiving owns the write.
  const listingUrl =
    (row.receiving_listing_url || '').trim() ||
    (readReceivingLineDetailsScratch(row.receiving_id).listing || '').trim();
  const listingOpenHref = listingUrlForOpen(listingUrl);
  const listingPreview = listingUrl
    ? listingLinkPreview(listingUrl)
    : (row.source_platform || 'no listing').toUpperCase();
  const recordedSerials = row.serials ?? [];
  const verdictPicked = verdict !== null;
  const hasSku = Boolean((row.sku || '').trim());
  const hasReceivingId = row.receiving_id != null;
  const primaryDisabled =
    !verdictPicked || verdict !== 'PASS' || isPrinting || saving || !hasSku || !hasReceivingId;
  const primaryTitle = !hasReceivingId
    ? 'Line is not linked to a carton'
    : !hasSku
      ? 'Line has no SKU — link a product before printing'
      : !verdictPicked
        ? 'Pick a testing verdict first'
        : verdict !== 'PASS'
          ? 'Only Pass produces a label — Test Again re-queues; Testing Failed opens claim'
          : `Print ${printQty} tested-OK label${printQty === 1 ? '' : 's'} for this line`;
  const primaryLabel = isPrinting
    ? `Printing ${printQty}×…`
    : !hasSku
      ? 'Pass · No SKU'
      : `Pass · Print ${printQty}× Label${printQty === 1 ? '' : 's'}`;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-gray-50">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
            {/* Toolbar — Audit + Copy. Mirrors LineEditPanel's header bar but
                trimmed to the two actions a tech actually needs. Refresh/
                Share/Zoho are receiver concerns and stay on the receiving
                page. */}
            <PaneHeaderActionBar
              actions={[
                {
                  key: 'audit',
                  label: 'Audit',
                  icon: <Info className="h-3.5 w-3.5" />,
                  onClick: () => setAuditOpen(true),
                  disabled: !row.receiving_id,
                  title: 'Audit log (inventory events)',
                  ariaLabel: 'View audit log',
                },
                {
                  key: 'copy',
                  label: 'Copy',
                  icon: <Copy className={`h-3.5 w-3.5 ${copyingAll ? 'animate-pulse' : ''}`} />,
                  onClick: () => void handleCopyAll(),
                  disabled: !row.receiving_id || copyingAll,
                  title: 'Copy carton + line details to clipboard',
                  ariaLabel: 'Copy all testing details',
                },
              ] satisfies PaneHeaderActionBarAction[]}
              status={saving ? 'Saving' : undefined}
            />

            {/* Carton header — photos + claim + listing/PO/tracking chips */}
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
              {row.receiving_id != null ? (
                <ReceivingCartonStaffDropdown
                  receivingId={row.receiving_id}
                  staffId={staffId}
                  onMakeClaim={() => setClaimOpen(true)}
                />
              ) : null}
              <div
                className={`px-4 py-3 ${row.receiving_id != null ? 'border-t border-gray-100' : ''}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ListingUrlChip
                      rawUrl={listingUrl}
                      openHref={listingOpenHref}
                      previewDisplay={listingPreview}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <OrderIdChip value={poNumber} display={poNumber ? getLast4(poNumber) : '----'} />
                    <TrackingChip
                      value={tracking}
                      display={tracking ? getLast4(tracking) : '----'}
                      disableCopy={!tracking}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* ── DIV 2 — Items + per-line pills, serial input, and claim ── */}
            {row.receiving_id != null ? (
              row.receiving_source === 'unmatched' ? (
                // Unmatched carton: no PO match, all lines visible at once.
                // Each gets its own verdict + serial adder; the workspace
                // tracks {verdictByLine} since there is no single active line.
                <UnmatchedItemsSection
                  receivingId={row.receiving_id}
                  renderLineActions={(line) => {
                    const lineVerdict = verdictByLine[line.id] ?? null;
                    return (
                      <div className="space-y-3">
                        <div className="min-w-0">
                          <TestingStatusPills
                            value={lineVerdict}
                            onChange={(next) => {
                              setVerdictByLine((prev) => ({ ...prev, [line.id]: next }));
                              // Patch THIS line's workflow_status — the
                              // shared patchLine helper writes to row.id
                              // (active line), so we hit the API directly
                              // for unmatched siblings.
                              const patch = verdictToReceivingLinePatch(next);
                              void fetch('/api/receiving-lines', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: line.id, ...patch }),
                              }).then(async (res) => {
                                const data = await res.json().catch(() => null);
                                if (data?.success && data.receiving_line) {
                                  dispatchLineUpdated(data.receiving_line);
                                }
                              });
                            }}
                            disabled={saving}
                          />
                        </div>
                        <InlineSerialAdder
                          key={`unmatched-adder-${line.id}`}
                          lineId={line.id}
                          saved={line.serials ?? []}
                          expected={line.quantity_expected ?? null}
                          isSubmitting={serialSubmitting}
                          onAdd={(lineId, sn) => submitSerial(lineId, sn)}
                          onReplaceSerial={(lineId, original, nextSerial) => {
                            if (original.id == null) return;
                            void replaceSerial(lineId, original.id, nextSerial);
                          }}
                          onDelete={(lineId, s) => {
                            if (s.id == null) return;
                            if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                            void deleteSerial(lineId, s.id);
                          }}
                        />
                      </div>
                    );
                  }}
                />
              ) : (
                <PoLinesAccordion
                  receivingId={row.receiving_id}
                  activeLineId={row.id}
                  activeRowSlot={({ serials }) => (
                    <div className="space-y-3">
                      <div className="min-w-0">
                        <TestingStatusPills
                          value={verdict}
                          onChange={handleVerdictChange}
                          disabled={saving}
                        />
                      </div>
                      {/* Per-PO-item serial input — scans route to THIS line's
                          id. `serials` comes from the accordion's own query
                          so the chip list below the input always matches the
                          chip shown in the row header (the parent's
                          `recordedSerials` lags on sibling switches). */}
                      <InlineSerialAdder
                        key={`adder-${row.id}`}
                        lineId={row.id}
                        saved={serials}
                        expected={row.quantity_expected ?? null}
                        isSubmitting={serialSubmitting}
                        disabled={!row.receiving_id}
                        autoFocus
                        onAdd={(lineId, sn) => submitSerial(lineId, sn)}
                        onReplaceSerial={(lineId, original, nextSerial) => {
                          if (original.id == null) return;
                          void replaceSerial(lineId, original.id, nextSerial);
                        }}
                        onDelete={(lineId, s) => {
                          if (s.id == null) return;
                          if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                          void deleteSerial(lineId, s.id);
                        }}
                      />
                    </div>
                  )}
                />
              )
            ) : null}

            {/* ── DIV 3 — Notes (per-line) ────────────────────────────────── */}
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
              <label
                htmlFor={`testing-notes-${row.id}`}
                className="block text-eyebrow font-black uppercase tracking-widest text-gray-500"
              >
                Notes
              </label>
              <textarea
                id={`testing-notes-${row.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  const next = notes.trim();
                  if (next !== (row.notes || '')) {
                    void patchLine({ notes: next || null });
                  }
                }}
                rows={2}
                placeholder="Test conditions, observations, repair handoff context…"
                className="mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-caption font-medium leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
              />
            </section>

            {previewPayload && row.sku ? (
              <LabelPreviewCard
                sku={row.sku}
                dataMatrixValue={previewPayload.value}
                dataMatrixSymbology={previewPayload.symbology}
                showReady={verdict === 'PASS'}
              />
            ) : null}
          </div>
        </div>

        {/* Sticky bar — left split menu = quantity picker; primary = Pass + Print */}
        <StickyActionBar
          primaryFullWidth
          primary={{
            label: primaryLabel,
            onClick: () => void handlePrimary(),
            disabled: primaryDisabled,
            isLoading: isPrinting,
            icon: isPrinting ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Printer className="h-4 w-4 shrink-0" />,
            toneClasses: { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700' },
            tone: 'emerald',
            menuLabel: 'Pick print quantity',
            menuTitle: 'Print quantity',
            menu: PRINT_QTY_OPTIONS.map((qty) => ({
              label: `Print ${qty}× label${qty === 1 ? '' : 's'}`,
              icon: <Printer className="h-3.5 w-3.5 shrink-0" />,
              onClick: () => setPrintQty(qty),
              title: printQty === qty ? 'Currently selected' : `Set quantity to ${qty}`,
            })),
            title: primaryTitle,
          }}
          hints={[
            { key: '⏎', label: 'Add serial' },
            verdictPicked
              ? { key: 'Qty', label: `${printQty}× labels` }
              : { key: '◉', label: 'Pick a verdict' },
          ]}
        />
      </div>

      <ReceivingClaimModal
        open={claimOpen}
        row={row}
        onClose={() => setClaimOpen(false)}
        onTicketCreated={(tk) => {
          toast.success(`Claim filed — ${tk}`);
          dispatchLineUpdated({ id: row.id });
        }}
      />

      {row.receiving_id != null ? (
        <ReceivingAuditModal
          open={auditOpen}
          onClose={() => setAuditOpen(false)}
          receivingId={row.receiving_id}
        />
      ) : null}
    </>
  );
}
