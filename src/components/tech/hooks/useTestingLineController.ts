'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import {
  unitStatusToVerdict,
  verdictToUnitStatus,
  type TestingVerdict,
} from '@/components/receiving/workspace/TestingStatusPills';
import { type UnitSlotSerial } from '@/components/tech/TestingUnitSlots';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import { takeSerialEditHandoff } from '@/components/receiving/workspace/serialEditHandoff';
import {
  buildUnitPayload,
  printProductLabel,
  resolveTestingLineTitle,
} from '@/lib/print/printProductLabel';
import { normalizeSku } from '@/utils/sku';
import { useReceivingLineCore } from '@/components/receiving/workspace/line-edit/hooks/useReceivingLineCore';
import { useCartonLabelEditor } from '@/components/receiving/workspace/line-edit/hooks/useCartonLabelEditor';
import { dispatchTestingLineUpdated } from '@/components/tech/testing-line-events';

interface NextIdResponse {
  ok: boolean;
  unitId: string;
  gtin: string | null;
  qrUrl: string | null;
  error?: string;
}

interface AllocatedUnit {
  unitId: string;
  gtin: string | null;
  qrUrl: string | null;
}

export type TestingLabelDraft = {
  title: string;
  color: string;
  condition: string;
};

/**
 * Controller for the TESTING workspace display. Composes the mode-agnostic
 * `useReceivingLineCore` (carton identity / copy / audit·claim) — passing the
 * rail-safe `dispatchTestingLineUpdated` so verdict clicks never clobber the
 * "You Tested" rail's verdict time — and layers the testing domain on top:
 * per-unit verdicts, the fire-and-forget serial queue, lazy unit-id minting,
 * and the Pass + Print auto-advance.
 *
 * Unlike the unbox controller, the parent (`TestingLineWorkspace`) owns `row`
 * and updates it from `receiving-line-updated`; this controller propagates its
 * mutations by dispatching that event (via core / dispatchTestingLineUpdated)
 * rather than holding a private row copy.
 */
export function useTestingLineController(
  row: ReceivingLineRow,
  staffId: string,
  opts?: { labelColor?: string },
) {
  const labelColor = opts?.labelColor ?? '';
  const core = useReceivingLineCore(row, staffId, { dispatchLine: dispatchTestingLineUpdated });
  const queryClient = useQueryClient();
  // Editable carton label (default draft + preview payload + Save & print),
  // driving the label preview's pencil → editor CTA — same face as unbox.
  const cartonLabel = useCartonLabelEditor(row, core, {
    conditionCode: row.condition_grade || 'USED_A',
    notes: (row.notes || '').trim(),
  });

  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const serialSubmittingRef = useRef(false);
  const [notes, setNotes] = useState<string>('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [activeSlotByLine, setActiveSlotByLine] = useState<Record<number, number>>({});
  const [previewBySerialUnit, setPreviewBySerialUnit] = useState<Record<number, AllocatedUnit>>({});
  const [isMutating, setIsMutating] = useState(false);
  const [headerSerialEdit, setHeaderSerialEdit] = useState<UnitSlotSerial | null>(null);

  const lineTitle = useMemo(() => resolveTestingLineTitle(row), [row]);

  // Bootstrap notes each time the line changes.
  useEffect(() => {
    setNotes(row.notes ?? '');
  }, [row.id, row.notes]);

  // Refresh the line's serials when it changes — table-side caches are slower.
  // A synthetic unfound-carton stub carries a negative id and has no
  // receiving_lines row to fetch (buildUnmatchedStubRow), so skip the request
  // rather than firing a guaranteed `success:false` GET on every stub scan.
  const refreshLineWithSerials = useCallback(async (id: number) => {
    if (!Number.isFinite(id) || id <= 0) return;
    try {
      const res = await fetch(`/api/receiving-lines?id=${id}&include=serials`);
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        dispatchTestingLineUpdated(data.receiving_line as ReceivingLineRow);
      }
    } catch {
      /* silent — next manual action will retry */
    }
  }, []);

  useEffect(() => {
    if (row.id > 0) void refreshLineWithSerials(row.id);
  }, [row.id, refreshLineWithSerials]);

  // Write a unit's new current_status into the accordion's siblings query cache
  // — the same store the verdict pills render from — so the highlight holds.
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

  // ── Per-unit verdict (optimistic) ─────────────────────────────────────────
  // Reflect the verdict IMMEDIATELY so the pill highlights and the Pass·Print
  // button enables with no processing wait, then persist in the background and
  // roll the unit status back on failure. `isMutating` stays a NON-blocking
  // "saving" chip on the toolbar — it no longer gates the verdict pills.
  const handleSlotVerdict = useCallback(
    async (lineId: number, serial: UnitSlotSerial, next: TestingVerdict) => {
      const priorStatus = serial.current_status;
      const optimisticStatus = verdictToUnitStatus(next);
      const receivingId = row.receiving_id;

      // Write one status to this serial across both stores the pills read from.
      const applyStatus = (status: string | null | undefined) => {
        if (status && lineId === row.id) {
          const nextSerials = (row.serials ?? []).map((s) =>
            s.id === serial.id ? { ...s, current_status: status } : s,
          );
          dispatchTestingLineUpdated({ id: lineId, serials: nextSerials });
        }
        if (status && typeof receivingId === 'number') {
          patchSiblingUnitStatus(receivingId, lineId, serial.id, status);
        }
      };

      applyStatus(optimisticStatus);
      window.dispatchEvent(new CustomEvent('testing-result-recorded'));
      if (next === 'TESTING_FAILED' && lineId === row.id) setClaimOpen(true);

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
          applyStatus(priorStatus); // roll back the optimistic verdict
          if (next === 'TESTING_FAILED' && lineId === row.id) setClaimOpen(false);
          return;
        }

        // The server's unit status already equals `optimisticStatus`, so leave
        // it (re-dispatching could clobber a newer press); only reconcile the
        // derived line-level state the server computes across all units.
        if (data.line) {
          dispatchTestingLineUpdated({
            id: lineId,
            workflow_status: data.line.workflow_status,
            qa_status: data.line.qa_status,
            disposition_code: data.line.disposition_code,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Verdict request failed');
        applyStatus(priorStatus); // roll back the optimistic verdict
        if (next === 'TESTING_FAILED' && lineId === row.id) setClaimOpen(false);
      } finally {
        setIsMutating(false);
      }
    },
    [row.id, row.serials, row.receiving_id, notes, patchSiblingUnitStatus],
  );

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
      await refreshLineWithSerials(lineId);
    },
    [handleSlotVerdict, refreshLineWithSerials],
  );

  const submitSerial = useCallback(
    async (lineId: number, raw: string) => {
      if (!row.receiving_id) return;
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
        if (lineId === row.id) await refreshLineWithSerials(row.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Network error scanning serial');
      } finally {
        serialSubmittingRef.current = false;
        setSerialSubmitting(false);
      }
    },
    [row.receiving_id, row.id, staffId, refreshLineWithSerials],
  );

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
          body: JSON.stringify({ serial_unit_id: serialUnitId, receiving_line_id: lineId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not remove serial');
          return;
        }
        toast.success('Serial removed');
        await refreshLineWithSerials(lineId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Remove failed');
      }
    },
    [refreshLineWithSerials],
  );

  const replaceSerial = useCallback(
    async (lineId: number, original: UnitSlotSerial, nextSerial: string) => {
      if (original.id == null) return;
      const next = (nextSerial ?? '').trim();
      if (!next || next === original.serial_number) return;
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial_unit_id: original.id, receiving_line_id: lineId }),
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

  const defaultActiveSlot = useCallback((line: ReceivingLineRow): number => {
    const serials = line.serials ?? [];
    const expected = line.quantity_expected ?? serials.length;
    for (let i = 0; i < serials.length; i++) {
      if (unitStatusToVerdict(serials[i].current_status) == null) return i;
    }
    if (serials.length < expected) return serials.length;
    return 0;
  }, []);

  const activeSlot = useMemo(
    () => activeSlotByLine[row.id] ?? defaultActiveSlot(row),
    [row, activeSlotByLine, defaultActiveSlot],
  );

  const activeSerial: UnitSlotSerial | null = useMemo(
    () => ((row.serials ?? [])[activeSlot] as UnitSlotSerial | undefined) ?? null,
    [row, activeSlot],
  );

  useEffect(() => {
    if (!row.sku || !activeSerial) return;
    if (previewBySerialUnit[activeSerial.id]) return;
    let cancelled = false;
    void (async () => {
      const allocation = await allocateUnitId(row.sku!);
      if (cancelled || !allocation) return;
      setPreviewBySerialUnit((m) => ({
        ...m,
        [activeSerial.id]: { unitId: allocation.unitId, gtin: allocation.gtin, qrUrl: allocation.qrUrl },
      }));
    })();
    return () => { cancelled = true; };
  }, [row.sku, activeSerial, previewBySerialUnit, allocateUnitId]);

  useEffect(() => {
    setPreviewBySerialUnit({});
    setHeaderSerialEdit(null);
    const handoff = row.id != null ? takeSerialEditHandoff(row.id) : null;
    if (handoff) setHeaderSerialEdit(handoff as UnitSlotSerial);
  }, [row.id]);

  const previewPayload = useMemo(() => {
    if (!row.sku) return null;
    const allocation = activeSerial ? previewBySerialUnit[activeSerial.id] : undefined;
    return buildUnitPayload({
      sku: allocation?.unitId || row.sku,
      serialNumber: activeSerial?.serial_number ?? null,
      qrPayload: allocation?.qrUrl ?? null,
      gtin: allocation?.gtin ?? null,
    });
  }, [row.sku, activeSerial, previewBySerialUnit]);

  const activeAllocation = activeSerial ? previewBySerialUnit[activeSerial.id] : undefined;

  const issueAndPrintLabel = useCallback(
    async (draft?: Partial<TestingLabelDraft>): Promise<boolean> => {
      if (!row.sku) {
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
        allocation = { unitId: next.unitId, gtin: next.gtin, qrUrl: next.qrUrl };
      }
      const title = (draft?.title ?? lineTitle).trim() || lineTitle;
      const condition = draft?.condition ?? (row.condition_grade || 'USED_A');
      const color = (draft?.color ?? labelColor).trim() || undefined;
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
            condition,
            printClass: 'print',
          }),
        });
      } catch (err) {
        console.warn('post-multi-sn failed (label still prints):', err);
      }
      printProductLabel({
        sku: allocation.unitId,
        title,
        serialNumber: activeSerial.serial_number,
        gtin: allocation.gtin ?? undefined,
        qrPayload: allocation.qrUrl ?? undefined,
        condition,
        color,
      });
      setPreviewBySerialUnit((m) => {
        const next = { ...m };
        delete next[activeSerial.id];
        return next;
      });
      return true;
    },
    [row.sku, row.condition_grade, lineTitle, activeSerial, previewBySerialUnit, allocateUnitId, notes, labelColor],
  );

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

  const advanceAfterPrint = useCallback(async () => {
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
  }, [row, activeSlot, findNextOpenSibling]);

  const handlePrimary = useCallback(async () => {
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
      const ok = await issueAndPrintLabel();
      if (!ok) return;
      toast.success('Label printed');
      await advanceAfterPrint();
    } finally {
      setIsPrinting(false);
    }
  }, [activeSerial, issueAndPrintLabel, advanceAfterPrint]);

  const handleApplyAndPrint = useCallback(
    async (draft: TestingLabelDraft) => {
      if (!activeSerial) {
        toast.info('Scan a serial for this slot before printing.');
        return;
      }
      const verdict = unitStatusToVerdict(activeSerial.current_status);
      if (verdict !== 'PASS') {
        toast.info('Mark this unit Pass before printing.');
        return;
      }
      setIsPrinting(true);
      try {
        const ok = await issueAndPrintLabel(draft);
        if (!ok) return;
        toast.success('Label printed');
      } finally {
        setIsPrinting(false);
      }
    },
    [activeSerial, issueAndPrintLabel],
  );

  return {
    ...core,
    notes, setNotes,
    serialSubmitting, headerSerialEdit, setHeaderSerialEdit, isMutating,
    activeSlotByLine, setActiveSlotByLine, activeSlot, activeSerial, activeAllocation,
    previewPayload, isPrinting,
    handleSlotVerdict, applyLineVerdict, deriveLineVerdict,
    enqueueSerial, deleteSerial, replaceSerial,
    handlePrimary, handleApplyAndPrint,
    // Editable carton label — preview payload + editor draft/build/apply (the
    // label preview's Carton option; pencil → LabelEditPopover → Save & print).
    cartonLabelPayload: cartonLabel.defaultPayload,
    cartonLabelDraftDefaults: cartonLabel.draftDefaults,
    buildCartonLabelPayload: cartonLabel.buildPayload,
    applyCartonLabel: cartonLabel.applyAndPrint,
    claimOpen, setClaimOpen,
  };
}
