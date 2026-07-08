'use client';

import { Fragment, useEffect, useState } from 'react';
import { Check } from '@/components/Icons';
import { receivingScanBandClass } from '@/components/layout/header-shell';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  RECEIVING_WORKFLOW_STEPS,
  deriveReceivingStepStates,
  type LinearStepState,
  type ReceivingStepKey,
} from './derive-receiving-step-states';
import { RECEIVING_WORKSPACE_HEADER_COLUMN } from './receiving-workspace-layout';

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
  /** Receiving label has been printed for this line (client-tracked). */
  labelPrinted?: boolean;
  /** Carton opened via scanner rather than sidebar rail click. */
  scanDriven?: boolean;
  /** PO sibling count — shows scope hint when 2+. */
  siblingLineCount?: number;
}

export type { LinearStepState, ReceivingStepKey };
export type LinearStep = { key: string; label: string };

export { deriveReceivingStepStates, activeReceivingStepKey } from './derive-receiving-step-states';

/**
 * Shared dot + connector stepper used by the receiving workspace header and
 * other flows (e.g. claim modal) that want the same visual language.
 */
export function LinearWorkflowStepper({
  steps,
  states,
  ariaLabel,
  ariaDescription,
  className = '',
  size = 'default',
  onStepClick,
  isStepDisabled,
}: {
  steps: ReadonlyArray<LinearStep>;
  states: Record<string, LinearStepState>;
  ariaLabel: string;
  ariaDescription?: string;
  className?: string;
  size?: 'default' | 'compact';
  onStepClick?: (key: string) => void;
  isStepDisabled?: (key: string) => boolean;
}) {
  const compact = size === 'compact';
  const connectorPt = compact ? 'pt-1.5' : 'pt-2';
  const stepGap = compact ? 'gap-0.5' : 'gap-1';
  const labelClass = compact
    ? 'text-eyebrow font-bold uppercase leading-none tracking-[0.1em]'
    : 'text-micro font-black uppercase leading-none tracking-[0.12em]';

  return (
    <nav aria-label={ariaLabel} aria-description={ariaDescription} className={className}>
      <ol className="flex w-full items-start">
        {steps.map((step, idx) => {
          const s = states[step.key] ?? 'pending';
          const prevState = idx > 0 ? (states[steps[idx - 1].key] ?? 'pending') : null;
          const labelTone =
            s === 'active'
              ? 'text-text-default font-black'
              : s === 'done'
                ? 'text-text-faint'
                : 'text-text-faint/70';
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
export function ReceivingProgressStepper({
  row,
  photoCount,
  serialCount,
  labelPrinted = false,
  scanDriven = true,
  siblingLineCount = 1,
}: Props) {
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

  const states = deriveReceivingStepStates({
    scanDriven,
    photoCount,
    serialCount,
    quantityExpected: row.quantity_expected ?? 0,
    conditionSet,
    labelPrinted,
  });

  const scopeHint =
    siblingLineCount > 1 ? `Progress for active line (${siblingLineCount} items on PO)` : undefined;

  return (
    <div className={`${receivingScanBandClass} bg-surface-card`}>
      <LinearWorkflowStepper
        steps={RECEIVING_WORKFLOW_STEPS}
        states={states}
        ariaLabel="Receiving progress"
        ariaDescription={scopeHint}
        size="compact"
        className={RECEIVING_WORKSPACE_HEADER_COLUMN}
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
  const sizeClass = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const checkClass = compact ? 'h-2 w-2' : 'h-2.5 w-2.5';
  if (state === 'done') {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-blue-600 text-white ${sizeClass}`}
      >
        <Check className={checkClass} aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-surface-card font-black text-blue-700 ring-2 ring-blue-500 ${sizeClass} ${
          compact ? 'text-[8px]' : 'text-eyebrow'
        }`}
      >
        {index}
      </span>
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-strong ring-1 ring-inset ring-border-soft ${sizeClass}`}
      aria-hidden
    />
  );
}
