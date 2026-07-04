'use client';

/**
 * Triage's own progress stepper — Scan → Classify → Stage → Pair → Ready.
 *
 * Replaces the shared `ReceivingProgressStepper` (Scan→Photos→Condition→Serial→
 * Print) for `variant='triage'`. Triage and unbox are different stations with
 * different jobs (docs/receiving-triage-redesign-plan.md §3.2) — sharing one
 * stepper implied triage cares about photos/serial/print, which it never has.
 *
 * State is DERIVED from the row (never stored) except the terminal "Ready" step,
 * which mirrors `ReceivingProgressStepper`'s `labelPrinted` pattern: the real
 * `triage_complete` column isn't threaded onto every feed's row shape yet (only
 * the Done-tab feed and a fresh save response carry it), so a client-tracked flag
 * closes the gap for the just-completed / already-known cases without requiring
 * every rail to widen its SELECT.
 */

import { useEffect, useState } from 'react';
import { receivingScanBandClass } from '@/components/layout/header-shell';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { LinearWorkflowStepper, type LinearStepState } from './ReceivingProgressStepper';
import { isTriageClassified, isTriageStaged, isTriagePaired } from '@/lib/receiving/triage-focus';

type TriageStepKey = 'scan' | 'classify' | 'stage' | 'pair' | 'ready';

const TRIAGE_STEPS: ReadonlyArray<{ key: TriageStepKey; label: string }> = [
  { key: 'scan',     label: 'Scan' },
  { key: 'classify', label: 'Classify' },
  { key: 'stage',    label: 'Stage' },
  { key: 'pair',     label: 'Pair' },
  { key: 'ready',    label: 'Ready' },
];

const TRIAGE_COMPLETE_KEY = (receivingId: number) => `receiving-triage-complete:${receivingId}`;

export function hasTriageBeenCompleted(receivingId: number | null | undefined): boolean {
  if (typeof window === 'undefined' || receivingId == null) return false;
  try {
    return !!window.localStorage.getItem(TRIAGE_COMPLETE_KEY(receivingId));
  } catch {
    return false;
  }
}

/** Called by the Save-for-unbox action on a successful `POST /triage/complete`. */
export function markTriageCompleted(receivingId: number | null | undefined): void {
  if (typeof window === 'undefined' || receivingId == null) return;
  try {
    window.localStorage.setItem(TRIAGE_COMPLETE_KEY(receivingId), String(Date.now()));
  } catch {
    /* private-mode / quota — non-fatal */
  }
  window.dispatchEvent(
    new CustomEvent('receiving-triage-completed', { detail: { receiving_id: receivingId } }),
  );
}

export function TriageProgressStepper({ row }: { row: ReceivingLineRow }) {
  const receivingId = row.receiving_id ?? null;
  const [locallyComplete, setLocallyComplete] = useState(() => hasTriageBeenCompleted(receivingId));
  useEffect(() => {
    setLocallyComplete(hasTriageBeenCompleted(receivingId));
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number | null }>).detail;
      if (detail?.receiving_id === receivingId) setLocallyComplete(true);
    };
    window.addEventListener('receiving-triage-completed', handler);
    return () => window.removeEventListener('receiving-triage-completed', handler);
  }, [receivingId]);

  const isReady = row.triage_complete === true || locallyComplete;

  const flags: Record<TriageStepKey, boolean> = {
    scan: true,
    classify: isTriageClassified(row),
    stage: isTriageStaged(row),
    pair: isTriagePaired(row),
    ready: isReady,
  };

  const states: Record<TriageStepKey, LinearStepState> = {
    scan: 'done', classify: 'pending', stage: 'pending', pair: 'pending', ready: 'pending',
  };
  let activeAssigned = false;
  for (const { key } of TRIAGE_STEPS) {
    if (flags[key]) {
      states[key] = 'done';
    } else if (!activeAssigned) {
      states[key] = 'active';
      activeAssigned = true;
    } else {
      states[key] = 'pending';
    }
  }

  return (
    <div className={`${receivingScanBandClass} bg-surface-card`}>
      <LinearWorkflowStepper
        steps={TRIAGE_STEPS}
        states={states}
        ariaLabel="Triage progress"
        className="mx-auto w-full max-w-3xl px-6 sm:px-8"
      />
    </div>
  );
}
