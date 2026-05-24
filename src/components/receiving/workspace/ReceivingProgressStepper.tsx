'use client';

import { Check } from '@/components/Icons';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

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
  // Derive each step's done-ness from row + counts. The first not-done step
  // becomes the "active" prompt; all subsequent steps render as pending.
  const isCondDone = (() => {
    const g = String(row.condition_grade || '').trim().toUpperCase();
    return g !== '' && g !== 'PENDING';
  })();
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
      className="border-b border-gray-100 bg-white/70 px-4 py-3 backdrop-blur sm:px-6"
    >
      <ol className="mx-auto flex w-full max-w-3xl items-start justify-between gap-1">
        {STEPS.map((step, idx) => {
          const s = states[step.key];
          const isLast = idx === STEPS.length - 1;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className="flex-1" aria-hidden>
                  {idx === 0 ? null : (
                    <span
                      className={`block h-px w-full ${
                        s === 'done' || s === 'active' ? 'bg-blue-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </span>
                <StepDot state={s} index={idx + 1} />
                <span className="flex-1" aria-hidden>
                  {isLast ? null : (
                    <span
                      className={`block h-px w-full ${
                        states[STEPS[idx + 1].key] === 'done' ? 'bg-blue-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </span>
              </div>
              <span
                className={`mt-1.5 text-micro font-black uppercase tracking-[0.14em] ${
                  s === 'done'
                    ? 'text-blue-600'
                    : s === 'active'
                      ? 'text-gray-900'
                      : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
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
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm shadow-blue-200">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-micro font-black text-blue-700 ring-2 ring-blue-500">
        {index}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-micro font-black text-gray-400 ring-2 ring-gray-200">
      {index}
    </span>
  );
}
