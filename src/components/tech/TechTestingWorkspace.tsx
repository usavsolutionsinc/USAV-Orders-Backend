'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Loader2, Printer } from '@/components/Icons';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { TextField } from '@/design-system/primitives';
import { OrderIdChip, TrackingChip, ListingUrlChip, TicketChip, getLast4 } from '@/components/ui/CopyChip';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { PoLinesAccordion } from '@/components/receiving/workspace/PoLinesAccordion';
import { takeSerialEditHandoff } from '@/components/receiving/workspace/serialEditHandoff';
import { UnmatchedItemsSection } from '@/components/receiving/workspace/UnmatchedItemsSection';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingAuditModal } from '@/components/receiving/workspace/ReceivingAuditModal';
import { PaneHeaderActionBar, type PaneHeaderActionBarAction } from '@/components/ui/pane-header';
import { Copy, History, ExternalLink, Link2 } from '@/components/Icons';
import { SkuPairingModal } from '@/components/products/pairing/SkuPairingModal';
import { buildReceivingCopyInfo } from '@/utils/copy-all-receiving';
import { copyToClipboard } from '@/utils/_dom';
import { ReceivingCartonStaffDropdown } from '@/components/sidebar/receiving/ReceivingCartonStaffDropdown';
import { LabelPreviewCard } from '@/components/labels/LabelPreviewCard';
import { TestingLinePanel, type UnitSlotSerial } from '@/components/tech/TestingUnitSlots';
import { SkuTestingPanel } from '@/components/tech/SkuTestingPanel';
import {
  unitStatusToVerdict,
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
import { buildUnitPayload, printProductLabel } from '@/lib/print/printProductLabel';
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
 * Like {@link dispatchLineUpdated}, but strips `last_activity_at` before it
 * reaches the rail. The Testing rail orders + renders by the tester's verdict
 * time (the API folds `tested_at` into `last_activity_at` for view=testing).
 * The by-id / PATCH refreshes this workspace fires on every line-select can't
 * reproduce that tester-scoped verdict time — they recompute `last_activity_at`
 * from the carton's scan/receive/import time. Dispatching those rows verbatim
 * clobbered the rail's "12h" with the scan time the instant a row was clicked,
 * so the relative timestamp jumped to "something completely different".
 * Omitting the field lets the merge keep the verdict time the rail already
 * holds. (Receiving solved its own version of this server-side, by having the
 * by-id query surface `last_scan_at` to match view=activity — but that axis is
 * scan-based, not verdict-based, so it can't rescue the testing feed here.)
 */
function dispatchTestingLineUpdated(
  row: Partial<ReceivingLineRow> & { id: number },
) {
  const patch = { ...row };
  delete patch.last_activity_at;
  dispatchLineUpdated(patch);
}

// ── Design-system surface tokens ───────────────────────────────────────────
// One source of truth for card geometry so every panel on the page stays
// consistent. `SECTION` is a flat hairline card; `SECTION_HERO` is the single
// elevated surface (the carton header) that's allowed to float. `EYEBROW` is
// the minimal section-label treatment (soft weight, muted, no uppercase)
// shared across the page. See /design-demo for the full menu of variants
// these were picked from.
const SECTION = 'rounded-2xl bg-white p-4 ring-1 ring-gray-200/70';
const SECTION_HERO =
  'overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70';
const EYEBROW = 'text-caption font-semibold text-gray-400';

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
interface AllocatedUnit {
  unitId: string;
  gtin: string | null;
  qrUrl: string | null;
}

export function TechTestingWorkspace({ staffId, selectedLineId, onSelectedLineChange }: Props) {
  const [row, setRow] = useState<ReceivingLineRow | null>(null);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  // Synchronous in-flight guard for the scan queue. The drainer fires
  // submitSerial calls back-to-back across React render boundaries, so a
  // state-based guard can read a stale `true` and silently drop a queued scan;
  // a ref is read/written synchronously, so it serializes without dropping.
  const serialSubmittingRef = useRef(false);
  const [printQty, setPrintQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  /**
   * Which unit slot the tech is focused on, keyed by receiving_lines.id.
   * Drives the global LabelPreviewCard + sticky Pass/Print. Mirrors the
   * `activeLineId` pattern at the line level but applied at the unit level
   * so a 6/6 line renders six addressable rows.
   */
  const [activeSlotByLine, setActiveSlotByLine] = useState<Record<number, number>>({});
  /**
   * Per-unit (`serial_units.id`) cache of the pre-allocated `{SKU}-{YEAR}-{SEQ6}`
   * value for the live preview + label print. Lazy: a slot doesn't burn an
   * id until the operator selects it. Cleared on row switch so siblings'
   * allocations don't leak into the new line's preview.
   */
  const [previewBySerialUnit, setPreviewBySerialUnit] = useState<Record<number, AllocatedUnit>>({});
  const [isMutating, setIsMutating] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);
  /**
   * Serial targeted by the active row header chip's Edit menu item. Feeds the
   * accordion (to highlight the chip) and the inline adder (to populate the
   * scan input for an in-place typo fix), mirroring receiving's LineEditPanel.
   */
  const [headerSerialEdit, setHeaderSerialEdit] = useState<UnitSlotSerial | null>(null);

  const lastSelectedRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  /**
   * Write a unit's new `current_status` straight into the accordion's
   * `['receiving-siblings', receivingId]` query cache — the same cache the
   * verdict pills render from. This keeps the optimistic verdict in the
   * authoritative store (instead of a separate event-bus copy that can drift),
   * so the highlight reflects the click immediately and isn't lost when an
   * unrelated refetch settles.
   */
  const patchSiblingUnitStatus = useCallback(
    (receivingId: number, lineId: number, serialId: number, status: string) => {
      queryClient.setQueryData(
        ['receiving-siblings', receivingId],
        (prev: { success?: boolean; receiving_lines?: ReceivingLineRow[] } | undefined) => {
          if (!prev?.receiving_lines) return prev;
          return {
            ...prev,
            receiving_lines: prev.receiving_lines.map((ln) =>
              ln.id === lineId
                ? {
                    ...ln,
                    serials: (ln.serials ?? []).map((s) =>
                      s.id === serialId ? { ...s, current_status: status } : s,
                    ),
                  }
                : ln,
            ),
          };
        },
      );
    },
    [queryClient],
  );

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

  // Bootstrap notes from the row each time it changes.
  useEffect(() => {
    if (!row) {
      setNotes('');
      setPrintQty(1);
      return;
    }
    setNotes(row.notes ?? '');
    setPrintQty(1);
  }, [row?.id, row?.notes]);

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
        dispatchTestingLineUpdated(data.receiving_line as ReceivingLineRow);
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
          dispatchTestingLineUpdated(data.receiving_line);
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

  // Carton-level priority (receiving.is_priority) — the shared unbox/test urgency
  // flag. Goes to receiving-logs (not receiving-lines) since it lives on the
  // carton; optimistic since that PATCH returns only {id}. Same column the
  // pending-order match in lookup-po sets automatically.
  const patchCartonPriority = useCallback(
    async (nextPriority: boolean) => {
      if (!row?.receiving_id) return;
      const lineId = row.id;
      setRow((cur) => (cur && cur.id === lineId ? { ...cur, is_priority: nextPriority } : cur));
      try {
        const res = await fetch('/api/receiving-logs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.receiving_id, is_priority: nextPriority }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        setRow((cur) => (cur && cur.id === lineId ? { ...cur, is_priority: !nextPriority } : cur));
        toast.error('Priority save failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [row],
  );

  // Per-line "needs test" (receiving_lines.needs_test) — cables/no-test items.
  // Clearing true→false is guarded server-side by tech assignment, so pass the
  // current tester as assigned_tech_id to satisfy it.
  const setLineNeedsTest = useCallback(
    (next: boolean) => {
      const fields: Record<string, unknown> = { needs_test: next };
      if (!next) {
        const techId = Number(staffId);
        if (Number.isFinite(techId) && techId > 0) fields.assigned_tech_id = techId;
      }
      void patchLine(fields);
    },
    [patchLine, staffId],
  );

  // ── Per-unit verdict ──────────────────────────────────────────────────────
  /**
   * Record a verdict against a single `serial_units` row. The server flips
   * the unit's `current_status` and rolls up the line's
   * `workflow_status` + `qa_status` across all sibling units in the same
   * transaction (see /api/serial-units/[id]/test). The response carries both
   * so we can update local state without an extra round-trip.
   *
   * Filing a claim is still a deliberate carton-level action via the Claim
   * button — picking "Testing Failed" only flags the unit as ON_HOLD.
   */
  const handleSlotVerdict = useCallback(
    async (lineId: number, serial: UnitSlotSerial, next: TestingVerdict) => {
      setIsMutating(true);
      try {
        const res = await fetch(`/api/serial-units/${serial.id}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            verdict: next,
            notes: notes.trim() || null,
            client_event_id: `testing-verdict-${serial.id}-${next}`,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          toast.error(data?.error || `Verdict save failed (${res.status})`);
          return;
        }

        // Patch the local row's serial entry with the unit's new
        // current_status so the workspace's print/slot logic (which reads
        // `row.serials`) sees the verdict without a refetch.
        setRow((current) => {
          if (!current || current.id !== lineId) return current;
          const nextSerials = (current.serials ?? []).map((s) =>
            s.id === serial.id
              ? { ...s, current_status: data.unit?.current_status ?? s.current_status }
              : s,
          );
          return { ...current, serials: nextSerials };
        });

        // Mirror the same status into the accordion's query cache — the pills'
        // actual source of truth — so the verdict highlight holds immediately
        // and survives an unrelated refetch settling.
        const nextStatus: string | undefined = data.unit?.current_status;
        const receivingId = rowRef.current?.receiving_id;
        if (nextStatus && typeof receivingId === 'number') {
          patchSiblingUnitStatus(receivingId, lineId, serial.id, nextStatus);
        }

        // A verdict was just recorded → refresh the "You Tested" rail so a
        // newly-tested line appears in this staff's recent feed.
        window.dispatchEvent(new CustomEvent('testing-result-recorded'));

        // Apply the server-computed line rollup so the rail + accordion
        // siblings live-update.
        if (data.line) {
          dispatchLineUpdated({
            id: lineId,
            workflow_status: data.line.workflow_status,
            qa_status: data.line.qa_status,
            disposition_code: data.line.disposition_code,
          });
          setRow((current) =>
            current && current.id === lineId
              ? ({
                  ...current,
                  workflow_status: data.line.workflow_status,
                  qa_status: data.line.qa_status,
                  disposition_code: data.line.disposition_code,
                } as ReceivingLineRow)
              : current,
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Verdict request failed');
      } finally {
        setIsMutating(false);
      }
    },
    [notes, patchSiblingUnitStatus],
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
      if (!serial || serialSubmittingRef.current) return;
      serialSubmittingRef.current = true;
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
        if (data.already_attached) {
          toast.info(`Already added — ${serial}`);
          return;
        }
        // Refresh the active row only when it matches; sibling rows pick the
        // update up via the `receiving-line-updated` event the API emits.
        if (lineId === row.id) await refreshLineWithSerials(row.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Network error scanning serial');
      } finally {
        serialSubmittingRef.current = false;
        setSerialSubmitting(false);
      }
    },
    [row, staffId, refreshLineWithSerials],
  );

  // Fire-and-forget scan queue: enqueueSerial() returns instantly so the
  // multi-qty testing rows can advance focus to the next unit's input without
  // waiting on the network. Writes still land in scan order, one at a time —
  // /api/receiving/scan-serial takes a row-level FOR UPDATE lock.
  const submitSerialRef = useRef(submitSerial);
  submitSerialRef.current = submitSerial;
  const serialQueueRef = useRef<Array<{ lineId: number; raw: string }>>([]);
  const drainingSerialsRef = useRef(false);
  const drainSerialQueue = useCallback(async () => {
    if (drainingSerialsRef.current) return;
    drainingSerialsRef.current = true;
    try {
      while (serialQueueRef.current.length > 0) {
        const next = serialQueueRef.current.shift();
        if (!next) break;
        await submitSerialRef.current(next.lineId, next.raw);
      }
    } finally {
      drainingSerialsRef.current = false;
    }
  }, []);
  const enqueueSerial = useCallback(
    (lineId: number, raw: string) => {
      const v = (raw ?? '').trim();
      if (!v) return;
      serialQueueRef.current.push({ lineId, raw: v });
      void drainSerialQueue();
    },
    [drainSerialQueue],
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
        // Refresh the line the serial actually belonged to (may be a collapsed
        // sibling, not the active row), so its accordion chips update too.
        await refreshLineWithSerials(lineId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Remove failed');
      }
    },
    [row, refreshLineWithSerials],
  );

  // Replace a saved serial in place (typo fix): delete the old serial_unit
  // then re-scan the corrected value. Mirrors the receiving adder's
  // `onReplaceSerial` contract so editing behaves identically on both pages.
  const replaceSerial = useCallback(
    async (lineId: number, original: UnitSlotSerial, nextSerial: string) => {
      if (original.id == null) return;
      const next = (nextSerial ?? '').trim();
      if (!next || next === original.serial_number) return;
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serial_unit_id: original.id,
            receiving_line_id: lineId,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not replace serial');
          return;
        }
        await submitSerial(lineId, next);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Replace failed');
      }
    },
    [submitSerial],
  );

  // One verdict per unit / PO line: collapse the line's serial statuses into a
  // single pill state. Any failure dominates, then any re-test, else a clean
  // PASS only when every saved serial passed. Empty → no verdict yet.
  const deriveLineVerdict = useCallback(
    (serials: ReadonlyArray<UnitSlotSerial>): TestingVerdict | null => {
      const verdicts = serials.map((s) => unitStatusToVerdict(s.current_status));
      if (verdicts.length === 0) return null;
      if (verdicts.some((v) => v === 'TESTING_FAILED')) return 'TESTING_FAILED';
      if (verdicts.some((v) => v === 'TEST_AGAIN')) return 'TEST_AGAIN';
      if (verdicts.every((v) => v === 'PASS')) return 'PASS';
      return null;
    },
    [],
  );

  // Apply one verdict across every serial on the line so the server-side line
  // rollup (workflow_status / qa_status) resolves cleanly. Sequential because
  // `/api/serial-units/[id]/test` recomputes the rollup on each call.
  const applyLineVerdict = useCallback(
    async (lineId: number, serials: ReadonlyArray<UnitSlotSerial>, next: TestingVerdict) => {
      const targets = serials.filter((s) => s.id != null);
      if (targets.length === 0) {
        toast.info('Scan a serial first, then set a verdict.');
        return;
      }
      for (const s of targets) {
        await handleSlotVerdict(lineId, s, next);
      }
      // The verdict pills + serial chips render off the PoLinesAccordion's
      // own serial cache, which only live-updates from `receiving-line-updated`
      // patches that carry a fresh `serials` array. handleSlotVerdict's rollup
      // dispatch omits the per-unit `current_status`, so without this the pill
      // highlight stays on the previous verdict until the next full refetch.
      // Re-fetch once (not per-unit) so the accordion sees every unit's new
      // status and `deriveLineVerdict` resolves to the verdict just applied.
      await refreshLineWithSerials(lineId);
    },
    [handleSlotVerdict, refreshLineWithSerials],
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

  // Default to the first un-tested slot when the line first lands. "First
  // un-tested" = the earliest slot whose unit hasn't been verdicted, falling
  // through to the first empty slot, then 0 if every slot is already done.
  const defaultActiveSlot = useCallback((line: ReceivingLineRow): number => {
    const serials = line.serials ?? [];
    const expected = line.quantity_expected ?? serials.length;
    for (let i = 0; i < serials.length; i++) {
      if (unitStatusToVerdict(serials[i].current_status) == null) return i;
    }
    if (serials.length < expected) return serials.length;
    return 0;
  }, []);

  const activeSlot = useMemo(() => {
    if (!row) return 0;
    return activeSlotByLine[row.id] ?? defaultActiveSlot(row);
  }, [row, activeSlotByLine, defaultActiveSlot]);

  const activeSerial: UnitSlotSerial | null = useMemo(() => {
    if (!row) return null;
    return (row.serials ?? [])[activeSlot] ?? null;
  }, [row, activeSlot]);

  // Allocate a unit id for the active slot lazily. The first time the
  // operator focuses a slot whose unit doesn't have an allocation yet, we
  // mint one — so empty slots and unfocused slots don't burn ids.
  useEffect(() => {
    if (!row?.sku || !activeSerial) return;
    if (previewBySerialUnit[activeSerial.id]) return;
    let cancelled = false;
    void (async () => {
      const allocation = await allocateUnitId(row.sku!);
      if (cancelled || !allocation) return;
      setPreviewBySerialUnit((m) => ({
        ...m,
        [activeSerial.id]: {
          unitId: allocation.unitId,
          gtin: allocation.gtin,
          qrUrl: allocation.qrUrl,
        },
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [row?.sku, activeSerial, previewBySerialUnit, allocateUnitId]);

  // Wipe the per-slot allocation cache when the line changes so a stale
  // id minted for the prior carton's serials never leaks into the new
  // preview.
  useEffect(() => {
    setPreviewBySerialUnit({});
    // Drop any in-progress serial edit so a target from the prior line never
    // populates the new line's scan input, then consume a handoff queued by
    // Edit on a non-active accordion row (applied once that line is active).
    setHeaderSerialEdit(null);
    const handoff = row?.id != null ? takeSerialEditHandoff(row.id) : null;
    if (handoff) setHeaderSerialEdit(handoff as UnitSlotSerial);
  }, [row?.id]);

  // Live preview payload — encodes the active slot's allocated unit id +
  // its physical serial in the DataMatrix, so the on-screen preview
  // matches the printed label exactly.
  const previewPayload = useMemo(() => {
    if (!row?.sku) return null;
    const allocation = activeSerial ? previewBySerialUnit[activeSerial.id] : undefined;
    return buildUnitPayload({
      sku: allocation?.unitId || row.sku,
      serialNumber: activeSerial?.serial_number ?? null,
      qrPayload: allocation?.qrUrl ?? null,
      gtin: allocation?.gtin ?? null,
    });
  }, [row?.sku, activeSerial, previewBySerialUnit]);

  const activeAllocation = activeSerial
    ? previewBySerialUnit[activeSerial.id]
    : undefined;

  /**
   * Print the active slot's tested-OK label. `count` is the number of
   * duplicate copies (warehouse stickers want N stickers per unit), not the
   * number of distinct unit ids — under the per-unit model each row owns
   * exactly one unit id. The pre-allocated id is reused; a fresh one is
   * minted only if the cache is empty (e.g., reload mid-flow).
   *
   * Also writes the unit through the canonical post-multi-sn pipeline so
   * it surfaces in Recently Printed + tech_serial_numbers + inventory_events
   * — same audit trail the products page leaves behind.
   */
  const issueAndPrintLabels = useCallback(
    async (count: number): Promise<boolean> => {
      if (!row || !row.sku) {
        toast.error('Line has no SKU — cannot issue label');
        return false;
      }
      if (!activeSerial) {
        toast.error('No serial on this slot — scan one first');
        return false;
      }

      let allocation = previewBySerialUnit[activeSerial.id];
      if (!allocation) {
        const next = await allocateUnitId(row.sku);
        if (!next) return false;
        allocation = {
          unitId: next.unitId,
          gtin: next.gtin,
          qrUrl: next.qrUrl,
        };
      }

      const payload = buildUnitPayload({
        sku: allocation.unitId,
        serialNumber: activeSerial.serial_number,
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
            serialNumbers: [activeSerial.serial_number],
            notes,
            condition: row.condition_grade || 'USED_A',
            printClass: 'print',
          }),
        });
      } catch (err) {
        console.warn('post-multi-sn failed (label still prints):', err);
      }

      // Print N duplicate copies of the same label. Stagger so the silent
      // print pipeline or browser print dialog doesn't drop jobs.
      const stagger = 200;
      for (let i = 0; i < count; i++) {
        window.setTimeout(() => {
          printProductLabel({
            sku: allocation!.unitId,
            // Canonical Zoho catalog title wins; PO/platform name is the fallback.
            title: (row.catalog_product_title ?? '').trim() || row.item_name || undefined,
            serialNumber: activeSerial.serial_number,
            gtin: allocation!.gtin ?? undefined,
            qrPayload: allocation!.qrUrl ?? undefined,
          });
        }, i * stagger);
      }

      // Burn the allocation — this slot just printed. Selecting it again
      // (rare — the operator usually moves on) will mint a fresh id.
      setPreviewBySerialUnit((m) => {
        const next = { ...m };
        delete next[activeSerial.id];
        return next;
      });
      return true;
    },
    [row, activeSerial, previewBySerialUnit, allocateUnitId, notes],
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
    // Only PASS prints. TEST_AGAIN + TESTING_FAILED never print — the verdict
    // pill already flipped the unit's status server-side. Print finalizes
    // PASS by minting + spitting out the sticker.
    if (!activeSerial) {
      toast.info('Scan a serial for this slot before printing.');
      return;
    }
    const verdict = unitStatusToVerdict(activeSerial.current_status);
    if (verdict !== 'PASS') {
      toast.info(
        verdict === 'TESTING_FAILED'
          ? 'Use the Claim button to file a ticket. No label will print on Fail.'
          : 'Mark this unit Pass before printing.',
      );
      return;
    }
    setIsPrinting(true);
    try {
      const ok = await issueAndPrintLabels(printQty);
      if (!ok) return;
      toast.success(`Printed ${printQty}× label${printQty === 1 ? '' : 's'}`);

      // Auto-advance within the line first — only fall through to the next
      // open sibling carton-line if every unit on this line is done.
      const serials = row.serials ?? [];
      const expected = row.quantity_expected ?? serials.length;
      const cap = Math.max(serials.length, expected);
      let nextSlot: number | null = null;
      for (let i = activeSlot + 1; i < cap; i++) {
        const s = serials[i];
        if (!s || unitStatusToVerdict(s.current_status) !== 'PASS') {
          nextSlot = i;
          break;
        }
      }
      if (nextSlot == null) {
        for (let i = 0; i <= activeSlot; i++) {
          const s = serials[i];
          if (!s || unitStatusToVerdict(s.current_status) !== 'PASS') {
            // Skip the slot we just printed unless it was an empty slot
            // (shouldn't happen — print requires a serial).
            if (i === activeSlot && s) continue;
            nextSlot = i;
            break;
          }
        }
      }

      if (nextSlot != null) {
        setActiveSlotByLine((m) => ({ ...m, [row.id]: nextSlot! }));
        return;
      }

      const next = await findNextOpenSibling(row);
      if (next) {
        dispatchSelectLine(next);
      } else {
        toast.success('Carton complete — all units tested', { duration: 2500 });
      }
    } finally {
      setIsPrinting(false);
    }
  }, [row, activeSerial, activeSlot, printQty, issueAndPrintLabels, findNextOpenSibling]);

  // Mount-time restore handles the no-row case (localStorage → most-recent),
  // so there's no operator-facing empty prompt — just a quiet holding area
  // until the restored row lands. Operator can use the sidebar rail at any
  // time to pick a different line.
  if (!row) {
    return <div className="h-full w-full bg-gray-50" aria-hidden />;
  }

  // ── Workspace ─────────────────────────────────────────────────────────────
  // Canonical Zoho catalog title (sku_catalog.product_title) wins; fall back to
  // the PO/platform line name (item_name) when the SKU isn't catalogued yet.
  const productTitle = (row.catalog_product_title ?? '').trim() || (row.item_name ?? '').trim();
  const poNumber = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const tracking = (row.tracking_number || '').trim();
  // Zendesk support ticket. Rendered as the orange TicketChip (matches the
  // repair-table ticket display) between the listing link and the PO number.
  const zendeskTrimmed = (row.zendesk_ticket || '').trim();
  const zendeskHref = zendeskTicketUrl(zendeskTrimmed);
  const zendeskChipDisplay = (() => {
    const raw = zendeskTrimmed.replace(/^#/, '').trim();
    const fromUrl = raw.match(/tickets\/(\d+)/);
    if (fromUrl) return fromUrl[1];
    return raw.length > 12 ? raw.slice(0, 12) : raw;
  })();
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
  const activeVerdict = unitStatusToVerdict(activeSerial?.current_status);
  const verdictPicked = activeVerdict !== null;
  const hasSku = Boolean((row.sku || '').trim());
  const hasReceivingId = row.receiving_id != null;
  const hasActiveSerial = activeSerial != null;
  const primaryDisabled =
    !hasActiveSerial ||
    !verdictPicked ||
    activeVerdict !== 'PASS' ||
    isPrinting ||
    saving ||
    !hasSku ||
    !hasReceivingId;
  const primaryTitle = !hasReceivingId
    ? 'Line is not linked to a carton'
    : !hasSku
      ? 'Line has no SKU — link a product before printing'
      : !hasActiveSerial
        ? 'Scan a serial for this slot before printing'
        : !verdictPicked
          ? 'Pick a testing verdict for this unit first'
          : activeVerdict !== 'PASS'
            ? 'Only Pass produces a label — Test Again re-queues; Testing Failed opens claim'
            : `Print ${printQty}× tested-OK label${printQty === 1 ? '' : 's'} for this unit`;
  const primaryLabel = isPrinting
    ? `Printing ${printQty}×…`
    : !hasSku
      ? 'Pass · No SKU'
      : !hasActiveSerial
        ? 'Pass · No Serial'
        : `Pass · Print ${printQty}× Label${printQty === 1 ? '' : 's'}`;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-gray-50">
        {/* Frozen utility toolbar — the workspace's top header row, mirroring
            LineEditPanel's third-row action bar (full-width 40px `header` band,
            icon-only) so Testing reads identically to Receiving. Lives OUTSIDE
            the scroll surface so it stays pinned while the body scrolls under
            it. Trimmed to the actions a tech needs (Audit / Pair / Copy) —
            Refresh/Share/Zoho are receiver concerns and stay on Receiving. The
            up/down chevrons step the sidebar's "You Tested" rail (prev/next),
            the same gesture Receiving's chevrons drive on the history table. */}
        <PaneHeaderActionBar
          variant="header"
          iconOnly
          actions={[
            {
              key: 'audit',
              label: 'Audit',
              // Clock glyph (same node Receiving's Audit uses) so the "view the
              // timeline" affordance reads identically across both workspaces.
              icon: <History className="h-3.5 w-3.5" />,
              onClick: () => setAuditOpen(true),
              disabled: !row.receiving_id,
              title: 'Audit log (inventory events)',
              ariaLabel: 'View audit log',
            },
            {
              key: 'pair',
              label: 'Pair',
              icon: <Link2 className="h-3.5 w-3.5" />,
              onClick: () => setPairOpen(true),
              disabled: row.sku_catalog_id == null,
              title:
                row.sku_catalog_id == null
                  ? 'SKU not in the catalog yet — nothing to pair'
                  : 'Pair this Zoho SKU to Ecwid / eBay / Amazon / etc.',
              ariaLabel: 'Pair SKUs',
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
          onPrev={() => window.dispatchEvent(new CustomEvent('testing-navigate-rail', { detail: 'prev' }))}
          onNext={() => window.dispatchEvent(new CustomEvent('testing-navigate-rail', { detail: 'next' }))}
          prevTitle="Previous recent line"
          nextTitle="Next recent line"
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-5 pb-8 sm:px-6">
            {/* Carton header — photos + claim + listing/PO/tracking chips.
                The ONE elevated surface on the page (SECTION_HERO) so the eye
                anchors here first. */}
            <section className={SECTION_HERO}>
              {row.receiving_id != null ? (
                <ReceivingCartonStaffDropdown
                  receivingId={row.receiving_id}
                  staffId={staffId}
                  onMakeClaim={() => setClaimOpen(true)}
                />
              ) : null}
              <div
                className={`px-4 py-3 ${row.receiving_id != null ? 'border-t border-gray-200/70' : ''}`}
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
                    {zendeskTrimmed ? (
                      <div className="flex shrink-0 items-center justify-end gap-1">
                        {zendeskHref ? (
                          <a
                            href={zendeskHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open Zendesk ticket"
                            title="Open in Zendesk"
                            className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        ) : null}
                        <TicketChip value={zendeskTrimmed} display={zendeskChipDisplay} />
                      </div>
                    ) : null}
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
                    const lineSerials = (line.serials ?? []) as UnitSlotSerial[];
                    return (
                      <TestingLinePanel
                        lineId={line.id}
                        saved={lineSerials}
                        expected={line.quantity_expected ?? null}
                        verdict={deriveLineVerdict(lineSerials)}
                        isMutating={isMutating}
                        isSubmitting={serialSubmitting}
                        disabled={saving}
                        selectedIndex={activeSlotByLine[line.id] ?? 0}
                        onSelectIndex={(i) =>
                          setActiveSlotByLine((m) => ({ ...m, [line.id]: i }))
                        }
                        onSetVerdict={(next) => void applyLineVerdict(line.id, lineSerials, next)}
                        onSetUnitVerdict={(serial, next) =>
                          void handleSlotVerdict(line.id, serial, next)
                        }
                        onAddSerial={(sn) => enqueueSerial(line.id, sn)}
                        onDeleteSerial={(s) => {
                          if (s.id == null) return;
                          if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                          void deleteSerial(line.id, s.id);
                        }}
                        onReplaceSerial={(original, next) =>
                          void replaceSerial(line.id, original, next)
                        }
                      />
                    );
                  }}
                />
              ) : (
                <PoLinesAccordion
                  receivingId={row.receiving_id}
                  activeLineId={row.id}
                  hideNoTestLines
                  activeSerialActions={{
                    editingSerialId: headerSerialEdit?.id ?? null,
                    // Only called for the active row — the accordion routes a
                    // non-active row's Edit through the handoff store + line
                    // switch, consumed on the row?.id effect above.
                    onEdit: (s) => setHeaderSerialEdit(s as UnitSlotSerial),
                    onDelete: (s, lineId) => {
                      if (s.id == null) return;
                      if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                      if (headerSerialEdit?.id === s.id) setHeaderSerialEdit(null);
                      void deleteSerial(lineId, s.id);
                    },
                  }}
                  activeRowSlot={({ serials }) => {
                    const lineSerials = serials as UnitSlotSerial[];
                    return (
                      <TestingLinePanel
                        lineId={row.id}
                        saved={lineSerials}
                        expected={row.quantity_expected ?? null}
                        verdict={deriveLineVerdict(lineSerials)}
                        isMutating={isMutating}
                        isSubmitting={serialSubmitting}
                        disabled={!row.receiving_id || saving}
                        autoFocus
                        showSavedChips={false}
                        editingSerial={headerSerialEdit}
                        onEditingSerialChange={setHeaderSerialEdit}
                        selectedIndex={activeSlot}
                        onSelectIndex={(i) =>
                          setActiveSlotByLine((m) => ({ ...m, [row.id]: i }))
                        }
                        onSetVerdict={(next) => void applyLineVerdict(row.id, lineSerials, next)}
                        onSetUnitVerdict={(serial, next) =>
                          void handleSlotVerdict(row.id, serial, next)
                        }
                        onAddSerial={(sn) => enqueueSerial(row.id, sn)}
                        onDeleteSerial={(s) => {
                          if (s.id == null) return;
                          if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                          void deleteSerial(row.id, s.id);
                        }}
                        onReplaceSerial={(original, next) =>
                          void replaceSerial(row.id, original, next)
                        }
                      />
                    );
                  }}
                />
              )
            ) : null}

            {/* ── DIV 3 — SKU testing panel (checklist edit + manuals) ────
                Resolves the line's SKU catalog (scanned unit → SKU crosswalk)
                so the checklist + manuals show before any serial is scanned;
                steps become recordable once a serial is on the active slot. */}
            {row.sku ? (
              <SkuTestingPanel
                receivingLineId={row.id}
                sku={row.sku}
                title={productTitle}
                serialUnitId={activeSerial?.id ?? null}
              />
            ) : null}

            {/* ── DIV 3.5 — Test triage toggles ───────────────────────────
                Priority = carton-level urgency (rank-0 in the Prioritize sort,
                shared with unbox). Needs test = per-line gate (uncheck cables so
                they skip the tester's queue). Two orthogonal axes. */}
            {row.receiving_id ? (
              <section className={SECTION}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-caption font-bold text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-red-600"
                      checked={!!row.is_priority}
                      onChange={(e) => void patchCartonPriority(e.target.checked)}
                    />
                    Priority <span className="font-medium text-gray-400">(whole carton)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-caption font-bold text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-600"
                      checked={row.needs_test !== false}
                      onChange={(e) => setLineNeedsTest(e.target.checked)}
                    />
                    Needs test <span className="font-medium text-gray-400">(this item)</span>
                  </label>
                </div>
              </section>
            ) : null}

            {/* ── DIV 4 — Notes (per-line) ────────────────────────────────── */}
            <section className={SECTION}>
              <TextField
                multiline
                rows={2}
                label="Notes"
                value={notes}
                onChange={setNotes}
                onBlur={() => {
                  const next = notes.trim();
                  if (next !== (row.notes || '')) {
                    void patchLine({ notes: next || null });
                  }
                }}
              />
            </section>

            {previewPayload && row.sku ? (
              <LabelPreviewCard
                sku={activeAllocation?.unitId || row.sku}
                title={productTitle}
                dataMatrixValue={previewPayload.value}
                dataMatrixSymbology={previewPayload.symbology}
                showReady={activeVerdict === 'PASS' && hasActiveSerial}
              />
            ) : null}
          </div>
        </div>

        {/* Floating pill — centered at the bottom, just the Pass + Print CTA.
            The chevron split-menu still drives the print-quantity picker. */}
        <StickyActionBar
          floating
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
        />
      </div>

      <ReceivingClaimModal
        open={claimOpen}
        row={row}
        onClose={() => setClaimOpen(false)}
        onTicketCreated={(tk) => {
          toast.success(`Claim filed — ${tk}`);
          // Show it immediately on the carton header; the claim route also
          // persisted it server-side so it survives reloads.
          setRow((current) => (current ? { ...current, zendesk_ticket: tk } : current));
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

      <SkuPairingModal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        skuCatalogId={row.sku_catalog_id ?? null}
      />
    </>
  );
}
