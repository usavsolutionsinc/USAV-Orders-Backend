'use client';

/**
 * Serial-scanning domain for the LineEditPanel: attach / delete / replace /
 * grade serial_units on a receiving line, plus the canonical refetch that keeps
 * the table + sibling accordion rows in sync.
 *
 * Extracted verbatim from LineEditPanel (which was carrying ~170 lines of this
 * inline) so the panel composes a focused API instead of owning the scan flow.
 * Serials are sidecar metadata — they attach an item identity + condition to a
 * line and never touch quantity_received or stock (that's the Receive action).
 *
 * Behaviour is unchanged: same endpoints, same toasts, same
 * `receiving-serial-scanned` broadcast and dispatchLineUpdated patches, same
 * RETURN-flow lookup ordering (the lookup runs BEFORE the upsert so it reflects
 * prior inventory rather than the row we're about to write).
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from '@/lib/toast';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import { dispatchUnboxRailLineUpdated } from '@/components/sidebar/receiving/unbox-rail-events';
import type { useSerialLookup } from '../../SerialMatchResult';

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

interface UseLineSerialsArgs {
  row: ReceivingLineRow;
  staffId: string;
  receivingType: string;
  serialInput: string;
  setSerialInput: (v: string) => void;
  serialLookup: ReturnType<typeof useSerialLookup>;
  serialInputRef: RefObject<HTMLInputElement | null>;
}

export function useLineSerials({
  row,
  staffId,
  receivingType,
  serialInput,
  setSerialInput,
  serialLookup,
  serialInputRef,
}: UseLineSerialsArgs) {
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  // Synchronous in-flight guard. The queue drainer fires submitSerial calls
  // back-to-back across React render boundaries, so a state-based guard can read
  // a stale `true` and silently drop a queued scan. A ref is updated/read
  // synchronously, so the guard is always accurate while still serializing.
  const submittingRef = useRef(false);

  const refreshLineWithSerials = useCallback(async (lineId: number = row.id) => {
    try {
      const res = await fetch(`/api/receiving-lines?id=${lineId}&include=serials`);
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        // dispatchLineUpdated patches the accordion's matching row, so editing
        // a serial on a non-active sibling refreshes that sibling's chips too.
        dispatchUnboxRailLineUpdated(data.receiving_line as ReceivingLineRow);
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
    if (!serial || !row.receiving_id || submittingRef.current) return;
    submittingRef.current = true;
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
        setTimeout(() => serialInputRef.current?.focus(), 40);
        void refreshLineWithSerials();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error scanning serial');
    } finally {
      submittingRef.current = false;
      setSerialSubmitting(false);
    }
  }, [
    serialInput,
    row.receiving_id,
    row.id,
    staffId,
    refreshLineWithSerials,
    row.serials,
    receivingType,
    serialLookup,
    setSerialInput,
    serialInputRef,
  ]);

  // Keep a live ref to the latest submitSerial so the queue drainer always
  // calls the current closure (fresh row.serials etc.) rather than a stale one.
  const submitSerialRef = useRef(submitSerial);
  submitSerialRef.current = submitSerial;

  // Serial scan queue. enqueueSerial() returns instantly so the multi-qty scan
  // UI can advance focus to the next unit's input without waiting on the
  // network — the operator scans a whole lot in one fast pass. The drainer
  // processes the queue one at a time because /api/receiving/scan-serial takes
  // a row-level FOR UPDATE lock; concurrent writes used to over-receive (2/1).
  const serialQueueRef = useRef<Array<{ raw: string; grade: string | null }>>([]);
  const drainingRef = useRef(false);
  const drainSerialQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (serialQueueRef.current.length > 0) {
        const next = serialQueueRef.current.shift();
        if (!next) break;
        await submitSerialRef.current(next.raw, next.grade);
      }
    } finally {
      drainingRef.current = false;
    }
  }, []);
  const enqueueSerial = useCallback(
    (raw?: string, grade?: string | null) => {
      const v = (raw ?? '').trim();
      if (!v) return;
      serialQueueRef.current.push({ raw: v, grade: grade ?? null });
      void drainSerialQueue();
    },
    [drainSerialQueue],
  );

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

  return {
    serialSubmitting,
    refreshLineWithSerials,
    submitSerial,
    enqueueSerial,
    deleteSerialUnit,
    replaceSerialUnit,
    setUnitGrade,
  };
}
