'use client';

import { Fragment } from 'react';
import { Check } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

export type RepairIntakeStepKey = 'product' | 'issue' | 'contact' | 'review';

export const REPAIR_INTAKE_STEPS: ReadonlyArray<{ key: RepairIntakeStepKey; label: string }> = [
  { key: 'product', label: 'Repair Service' },
  { key: 'issue', label: 'Issue / Reason' },
  { key: 'contact', label: 'Contact Information' },
  { key: 'review', label: 'Review' },
];

type StepState = 'done' | 'active' | 'pending';

interface RepairIntakeStepperProps {
  currentStep: RepairIntakeStepKey;
  /** Inline header row — circles only, tighter spacing. */
  compact?: boolean;
  /** Stretch connectors to fill the host column width (e.g. 720px). */
  spread?: boolean;
  onStepClick?: (key: RepairIntakeStepKey) => void;
  canNavigateTo?: (key: RepairIntakeStepKey) => boolean;
}

function stepState(key: RepairIntakeStepKey, current: RepairIntakeStepKey): StepState {
  const order = REPAIR_INTAKE_STEPS.map((s) => s.key);
  const ci = order.indexOf(current);
  const ki = order.indexOf(key);
  if (ki < ci) return 'done';
  if (ki === ci) return 'active';
  return 'pending';
}

function connectorTone(leftState: StepState): string {
  return leftState === 'done' ? 'bg-gray-900' : 'bg-gray-200';
}

export function RepairIntakeStepper({
  currentStep,
  compact = false,
  spread = false,
  onStepClick,
  canNavigateTo,
}: RepairIntakeStepperProps) {
  const nodeSize = compact || spread ? 'h-7 w-7' : 'h-8 w-8';
  const connectorMt = compact || spread ? 'mt-3.5' : 'mt-4';
  const connectorW = compact ? 'w-3 sm:w-5' : 'w-6 sm:w-10';
  const colW = compact || spread ? 'w-auto shrink-0' : 'w-[4.75rem] sm:w-[5.5rem]';
  const numSize = compact || spread ? 'text-micro' : 'text-caption';

  const renderStepNode = (step: (typeof REPAIR_INTAKE_STEPS)[number], idx: number) => {
    const state = stepState(step.key, currentStep);
    const clickable =
      !!onStepClick &&
      state === 'done' &&
      (canNavigateTo ? canNavigateTo(step.key) : true);

    return (
      <HoverTooltip label={step.label} asChild>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && onStepClick?.(step.key)}
          className={`ds-raw-button flex ${nodeSize} shrink-0 items-center justify-center rounded-full border-2 transition-all ${
            state === 'done'
              ? 'border-gray-900 bg-gray-900 text-white'
              : state === 'active'
                ? 'border-gray-900 bg-white text-gray-900 ring-2 ring-gray-900/10'
                : 'border-gray-200 bg-white text-gray-300'
          } ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-gray-900/10' : 'cursor-default'}`}
          aria-current={state === 'active' ? 'step' : undefined}
          aria-label={step.label}
        >
          {state === 'done' ? (
            <Check className={compact || spread ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          ) : (
            <span className={`${numSize} font-black tabular-nums`}>{idx + 1}</span>
          )}
        </button>
      </HoverTooltip>
    );
  };

  if (spread) {
    return (
      <nav aria-label="Repair intake progress" className="flex w-full">
        <ol className="flex w-full items-start">
          {REPAIR_INTAKE_STEPS.map((step, idx) => {
            const state = stepState(step.key, currentStep);

            return (
              <Fragment key={step.key}>
                {idx > 0 ? (
                  <li className={`flex min-w-3 flex-1 items-start ${connectorMt}`} aria-hidden>
                    <div
                      className={`h-px w-full ${connectorTone(
                        stepState(REPAIR_INTAKE_STEPS[idx - 1].key, currentStep),
                      )}`}
                    />
                  </li>
                ) : null}
                <li className="flex shrink-0 flex-col items-center">
                  {renderStepNode(step, idx)}
                  <span
                    className={`mt-2 max-w-[4.25rem] text-center text-mini font-black uppercase leading-tight tracking-[0.08em] sm:max-w-[5rem] sm:text-eyebrow sm:tracking-[0.1em] ${
                      state === 'active'
                        ? 'text-gray-900'
                        : state === 'done'
                          ? 'text-gray-600'
                          : 'text-gray-300'
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Repair intake progress"
      className={compact ? 'flex min-w-0 justify-center' : 'flex w-full justify-center'}
    >
      <ol className="flex items-start">
        {REPAIR_INTAKE_STEPS.map((step, idx) => {
          const state = stepState(step.key, currentStep);
          const clickable =
            !!onStepClick &&
            state === 'done' &&
            (canNavigateTo ? canNavigateTo(step.key) : true);

          return (
            <li key={step.key} className="flex items-start">
              {idx > 0 && (
                <div
                  className={`${connectorMt} h-px ${connectorW} ${connectorTone(
                    stepState(REPAIR_INTAKE_STEPS[idx - 1].key, currentStep),
                  )}`}
                  aria-hidden
                />
              )}

              <div className={`flex flex-col items-center ${colW}`}>
                <HoverTooltip label={step.label} asChild>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onStepClick?.(step.key)}
                    className={`ds-raw-button flex ${nodeSize} shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                      state === 'done'
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : state === 'active'
                          ? 'border-gray-900 bg-white text-gray-900 ring-2 ring-gray-900/10'
                          : 'border-gray-200 bg-white text-gray-300'
                    } ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-gray-900/10' : 'cursor-default'}`}
                    aria-current={state === 'active' ? 'step' : undefined}
                    aria-label={step.label}
                  >
                    {state === 'done' ? (
                      <Check className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                    ) : (
                      <span className={`${numSize} font-black tabular-nums`}>{idx + 1}</span>
                    )}
                  </button>
                </HoverTooltip>

                {!compact && (
                  <span
                    className={`mt-2 w-full text-center text-mini font-black uppercase leading-tight tracking-[0.1em] sm:text-eyebrow sm:tracking-[0.12em] ${
                      state === 'active'
                        ? 'text-gray-900'
                        : state === 'done'
                          ? 'text-gray-600'
                          : 'text-gray-300'
                    }`}
                  >
                    {step.label}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
