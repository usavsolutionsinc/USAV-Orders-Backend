'use client';

import { Fragment, useEffect, useState } from 'react';
import { Check } from '@/components/Icons';
import { receivingScanBandClass } from '@/components/layout/header-shell';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

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
export type LinearStepState = 'done' | 'active' | 'pending';

export type LinearStep = { key: string; label: string };

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'scan',      label: 'Scan' },
  { key: 'photos',    label: 'Photos' },
  { key: 'condition', label: 'Condition' },
  { key: 'serial',    label: 'Serial' },
  { key: 'print',     label: 'Print' },
];

/**
 * Shared dot + connector stepper used by the receiving workspace header and
 * other flows (e.g. claim modal) that want the same visual language.
 */
export function LinearWorkflowStepper({
  steps,
  states,
  ariaLabel,
  className = '',
  size = 'default',
  onStepClick,
  isStepDisabled,
}: {
  steps: ReadonlyArray<LinearStep>;
  states: Record<string, LinearStepState>;
  ariaLabel: string;
  className?: string;
  size?: 'default' | 'compact';
  onStepClick?: (key: string) => void;
  isStepDisabled?: (key: string) => boolean;
}) {
  const compact = size === 'compact';
  const connectorPt = compact ? 'pt-2' : 'pt-2.5';
  const stepGap = compact ? 'gap-1' : 'gap-1.5';
  const labelClass = compact
    ? 'text-eyebrow font-bold uppercase leading-none tracking-[0.1em]'
    : 'text-micro font-black uppercase leading-none tracking-[0.12em]';

  return (
    <nav aria-label={ariaLabel} className={className}>
      <ol className="flex w-full items-start">
        {steps.map((step, idx) => {
          const s = states[step.key] ?? 'pending';
          const prevState = idx > 0 ? (states[steps[idx - 1].key] ?? 'pending') : null;
          const labelTone =
            s === 'done'
              ? 'text-blue-600'
              : s === 'active'
                ? 'text-text-default'
                : 'text-text-faint';
          const disabled = isStepDisabled?.(step.key) ?? false;
          const clickable = !!onStepClick && !disabled;

          const stepContent = (
            <>
              <StepDot state={s} index={idx + 1} compact={compact} />
              <span className={`whitespace-nowrap text-center ${labelClass} ${labelTone}`}>
                {step.label}
              </span>
            </>
          );

          return (
            <Fragment key={step.key}>
              {idx > 0 ? (
                <li aria-hidden className={`min-w-0 flex-1 self-start ${connectorPt}`}>
                  <span
                    className={`block h-px w-full ${
                      prevState === 'done' ? 'bg-blue-300' : 'bg-surface-strong'
                    }`}
                  />
                </li>
              ) : null}
              <li className={`flex shrink-0 flex-col items-center ${stepGap}`}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onStepClick(step.key)}
                    className={`ds-raw-button flex flex-col items-center ${stepGap}`}
                  >
                    {stepContent}
                  </button>
                ) : (
                  <div
                    className={`flex flex-col items-center ${stepGap} ${
                      disabled ? 'cursor-not-allowed opacity-45' : ''
                    }`}
                  >
                    {stepContent}
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Five-dot horizontal stepper that mirrors the operator's actual workflow:
 *   Scan → Photos → Condition → Serial → Print
 *
 * State is *derived* from the row — never stored — so it always reflects the
 * current source of truth. The "active" dot is the next pending step; earlier
 * steps render as done, later steps render as pending.
 */
export function ReceivingProgressStepper({ row, photoCount, serialCount, isComplete, labelPrinted = false }: Props) {
  const [conditionSet, setConditionSet] = useState(
    () => !!row.condition_set_at || hasConditionBeenSet(row.id),
  );
  useEffect(() => {
    setConditionSet(!!row.condition_set_at || hasConditionBeenSet(row.id));
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line_id: number }>).detail;
      if (!detail || detail.line_id !== row.id) return;
      setConditionSet(true);
    };
    window.addEventListener('receiving-condition-set', handler);
    return () => window.removeEventListener('receiving-condition-set', handler);
  }, [row.id, row.condition_set_at]);
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
  const states: Record<StepKey, LinearStepState> = {
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
    <div className={`${receivingScanBandClass} bg-surface-card`}>
      <LinearWorkflowStepper
        steps={STEPS}
        states={states}
        ariaLabel="Receiving progress"
        className="mx-auto w-full max-w-3xl px-6 sm:px-8"
      />
    </div>
  );
}

function StepDot({
  state,
  index,
  compact = false,
}: {
  state: LinearStepState;
  index: number;
  compact?: boolean;
}) {
  const sizeClass = compact ? 'h-4 w-4 text-eyebrow' : 'h-5 w-5 text-micro';
  const checkClass = compact ? 'h-2.5 w-2.5' : 'h-3 w-3';
  if (state === 'done') {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-blue-600 text-white ${sizeClass} ${
          compact ? '' : 'shadow-sm shadow-blue-200'
        }`}
      >
        <Check className={checkClass} aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-surface-card font-black text-blue-700 ring-2 ring-blue-500 ${sizeClass}`}
      >
        {index}
      </span>
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-card font-black text-text-faint ring-2 ring-border-soft ${sizeClass}`}
    >
      {index}
    </span>
  );
}
