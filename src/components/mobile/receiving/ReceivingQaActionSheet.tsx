'use client';

/**
 * ReceivingQaActionSheet
 * ─────────────────────────────────────────────────────────────────────
 * Sticky-bottom launcher on `/m/r/[id]` that lets a tech mark every
 * line on a received carton as PASSED or FAILED (return) from one tap.
 *
 * Behaviour:
 *   • One BottomSheet row per outcome (PASS, FAIL, add note).
 *   • Destructive FAIL opens a stacked ConfirmSheet asking for a reason.
 *   • Each chosen action POSTs `/api/receiving/mark-received` ONCE PER
 *     line in the carton — that endpoint is the official writer for
 *     `receiving_lines.qa_status`.
 *
 * The mobile center scan button never calls this directly; the tech has
 * to be on a specific carton's detail page to fire it. That's the
 * intentional invariant: the scan flow is intent-routing, the action
 * sheet is the deliberate mutation.
 */

import { useState } from 'react';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { toast } from 'sonner';
import { BottomSheet, ConfirmSheet } from '@/components/ui/BottomSheet';

export interface ReceivingLineLite {
  id: number;
  sku: string | null;
  workflow_status: string | null;
  qa_status: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  receivingId: number;
  lines: ReceivingLineLite[];
  onMutated?: () => void;
}

async function markAllLines(
  lines: ReceivingLineLite[],
  qaStatus: 'PASSED' | 'FAILED_FUNCTIONAL' | 'FAILED_DAMAGED' | 'FAILED_INCOMPLETE',
  dispositionCode: 'ACCEPT' | 'RTV' | 'HOLD',
  notes: string | null,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const line of lines) {
    try {
      const res = await fetch('/api/receiving/mark-received', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_line_id: line.id,
          qa_status: qaStatus,
          disposition_code: dispositionCode,
          condition_grade: qaStatus === 'PASSED' ? 'USED_A' : 'PARTS',
          notes,
          client_event_id: safeRandomUUID(),
        }),
      });
      if (res.ok) ok += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}

export function ReceivingQaActionSheet({ open, onClose, receivingId, lines, onMutated }: Props) {
  const [confirmFail, setConfirmFail] = useState<null | { reason: string }>(null);
  const [confirmPass, setConfirmPass] = useState(false);
  const [busy, setBusy] = useState(false);

  const lineCount = lines.length;

  const runPass = async () => {
    setBusy(true);
    const { ok, failed } = await markAllLines(lines, 'PASSED', 'ACCEPT', null);
    setBusy(false);
    setConfirmPass(false);
    onClose();
    if (failed > 0) toast.error(`Marked ${ok} passed · ${failed} failed`);
    else toast.success(`Marked ${ok} line${ok === 1 ? '' : 's'} as tested PASS`);
    onMutated?.();
  };

  const runFail = async () => {
    if (!confirmFail) return;
    setBusy(true);
    const { ok, failed } = await markAllLines(
      lines,
      'FAILED_FUNCTIONAL',
      'RTV',
      confirmFail.reason || null,
    );
    setBusy(false);
    setConfirmFail(null);
    onClose();
    if (failed > 0) toast.error(`Returned ${ok} · ${failed} failed`);
    else toast.success(`Marked ${ok} line${ok === 1 ? '' : 's'} as FAILED · return`);
    onMutated?.();
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={`RCV-${receivingId} · ${lineCount} line${lineCount === 1 ? '' : 's'}`}>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setConfirmPass(true)}
            disabled={busy || lineCount === 0}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-sm font-black uppercase tracking-wider text-white shadow-md shadow-emerald-600/30 transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            Mark tested — PASS
          </button>
          <button
            type="button"
            onClick={() => setConfirmFail({ reason: '' })}
            disabled={busy || lineCount === 0}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 text-sm font-black uppercase tracking-wider text-white shadow-md shadow-rose-600/30 transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            Mark FAILED — return
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>

      <ConfirmSheet
        open={confirmPass}
        onClose={() => setConfirmPass(false)}
        title={`Mark ${lineCount} line${lineCount === 1 ? '' : 's'} PASSED?`}
        message="Marks each line tested-PASS with disposition ACCEPT. Cannot be undone from this screen."
        confirmLabel={busy ? 'Working…' : 'Yes, mark PASSED'}
        onConfirm={runPass}
      />

      {confirmFail && (
        <ConfirmSheet
          open={!!confirmFail}
          onClose={() => setConfirmFail(null)}
          title="Mark FAILED — return"
          message="Marks every line tested-FAIL with disposition RTV (return to vendor). Use the note field below to capture the reason."
          confirmLabel={busy ? 'Working…' : 'Yes, return all'}
          destructive
          onConfirm={runFail}
        />
      )}
    </>
  );
}
