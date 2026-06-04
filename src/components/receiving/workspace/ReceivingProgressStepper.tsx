'use client';

import { useEffect, useState } from 'react';
import { Check } from '@/components/Icons';
import { receivingScanBandClass } from '@/components/layout/header-shell';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

/**
 * Per-line localStorage key set by ConditionPills callers when the operator
 * actively picks a condition. Without this signal we can't tell apart the
 * receiving_lines.condition_grade NOT NULL default ('BRAND_NEW') from a real
 * operator selection — every row comes back from the DB with a non-empty
 * grade, so a naive "non-empty ⇒ done" check marks Condition done on
 * cartons the operator hasn't even looked at.
 */
const CONDITION_SET_KEY = (lineId: number) =>
  `receiving-condition-set:${lineId}`;

export function hasConditionBeenSet(lineId: number | null | undefined): boolean {
  if (typeof window === 'undefined' || lineId == null) return false;
  try {
    return !!window.localStorage.getItem(CONDITION_SET_KEY(lineId));
  } catch {
    return false;
  }
}

export function markConditionSet(lineId: number | null | undefined): void {
  if (typeof window === 'undefined' || lineId == null) return;
  try {
    window.localStorage.setItem(CONDITION_SET_KEY(lineId), String(Date.now()));
  } catch {
    /* private-mode / quota — non-fatal */
  }
  window.dispatchEvent(
    new CustomEvent('receiving-condition-set', { detail: { line_id: lineId } }),
  );
}

interface Props {
  row: ReceivingLineRow;
  photoCount: number;
  serialCount: number;
  /** Workflow status considered "fully done" (e.g. 'DONE', 'PASSED'). */
  isComplete: boolean;
  /** Receiving label has been printed for this line (client-tracked). */
  labelPrinted?: boolean;
}

type StepKey = 'scan' | 'photos' | 'condition' | 'serial' | 'print';
type StepState = 'done' | 'active' | 'pending';

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'scan',      label: 'Scan' },
  { key: 'photos',    label: 'Photos' },
  { key: 'condition', label: 'Condition' },
  { key: 'serial',    label: 'Serial' },
  { key: 'print',     label: 'Print' },
];

/**
 * Five-dot horizontal stepper that mirrors the operator's actual workflow:
 *   Scan → Photos → Condition → Serial → Print
 *
 * State is *derived* from the row — never stored — so it always reflects the
 * current source of truth. The "active" dot is the next pending step; earlier
 * steps render as done, later steps render as pending.
 */
export function ReceivingProgressStepper({ row, photoCount, serialCount, isComplete, labelPrinted = false }: Props) {
  // Track whether the operator has actively picked a condition for THIS
  // line. We can't rely on row.condition_grade alone because the column
  // defaults to 'BRAND_NEW' for every newly inserted line, which used to
  // make Condition auto-mark itself done before the operator even saw
  // the carton. Falls back to workflow_status for back-compat.
  const [conditionSet, setConditionSet] = useState(() =>
    hasConditionBeenSet(row.id),
  );
  useEffect(() => {
    setConditionSet(hasConditionBeenSet(row.id));
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line_id: number }>).detail;
      if (!detail || detail.line_id !== row.id) return;
      setConditionSet(true);
    };
    window.addEventListener('receiving-condition-set', handler);
    return () => window.removeEventListener('receiving-condition-set', handler);
  }, [row.id]);
  const isCondDone = conditionSet || isComplete;
  const expected = row.quantity_expected ?? 0;
  const isSerialDone = expected > 0 ? serialCount >= expected : serialCount > 0;
  const isPhotosDone = photoCount > 0;

  const flags: Record<StepKey, boolean> = {
    scan: true,                   // we wouldn't be here without a scan/select
    photos: isPhotosDone,
    condition: isCondDone,
    serial: isSerialDone,
    print: labelPrinted || isComplete,
  };

  // Compute states: walk left-to-right, first non-done step is "active".
  const states: Record<StepKey, StepState> = {
    scan: 'done', photos: 'pending', condition: 'pending', serial: 'pending', print: 'pending',
  };
  let activeAssigned = false;
  for (const { key } of STEPS) {
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
    <nav
      aria-label="Receiving progress"
      className={`${receivingScanBandClass} bg-white`}
    >
      {/* Shares the action toolbar's `px-6 sm:px-8` column so the row edges
          line up. Each step's dot + label share one centered column so the
          checkmark sits on the label's vertical axis. */}
      <ol className="mx-auto flex w-full max-w-3xl items-center justify-between gap-0.5 px-6 sm:px-8">
        {STEPS.map((step, idx) => {
          const s = states[step.key];
          const isLast = idx === STEPS.length - 1;
          return (
            <li
              key={step.key}
              // Half-width end cells (flexGrow 0.5 vs 1) so the 5 dots land at
              // 0 / 25 / 50 / 75 / 100% with EQUAL connectors. With full-width
              // end cells the edge-pinned SCAN/PRINT dots made the first/last
              // gaps wider than the middle ones. Set via inline style (not the
              // arbitrary `flex-[0.5]` utility, which the build didn't emit).
              className="flex min-w-0 flex-1 flex-col justify-center"
              style={{ flexBasis: 0, flexGrow: idx === 0 || isLast ? 0.5 : 1 }}
            >
              <div className="flex w-full items-center">
                <span className={idx === 0 ? 'w-0 shrink-0' : 'min-w-0 flex-1'} aria-hidden>
                  {idx === 0 ? null : (
                    <span
                      className={`block h-px w-full ${
                        s === 'done' || s === 'active' ? 'bg-blue-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </span>
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  <StepDot state={s} index={idx + 1} />
                  <span
                    className={`whitespace-nowrap text-center text-[10px] font-black uppercase leading-none tracking-[0.12em] ${
                      s === 'done'
                        ? 'text-blue-600'
                        : s === 'active'
                          ? 'text-gray-900'
                          : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                <span className={isLast ? 'w-0 shrink-0' : 'min-w-0 flex-1'} aria-hidden>
                  {isLast ? null : (
                    <span
                      className={`block h-px w-full ${
                        states[STEPS[idx + 1].key] === 'done' ? 'bg-blue-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepDot({ state, index }: { state: StepState; index: number }) {
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm shadow-blue-200">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-blue-700 ring-2 ring-blue-500">
        {index}
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-gray-400 ring-2 ring-gray-200">
      {index}
    </span>
  );
}
