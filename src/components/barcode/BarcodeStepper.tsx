'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from '../Icons';
import type { BarcodeMode } from './ModeSelector';

interface StepDef {
  id: number;
  label: string;
}

function stepsForMode(mode: BarcodeMode): StepDef[] {
  if (mode === 'reprint') {
    return [
      { id: 1, label: 'SKU' },
      { id: 2, label: 'Reprint' },
    ];
  }
  return [
    { id: 1, label: 'SKU' },
    { id: 2, label: mode === 'sn-to-sku' ? 'Serials' : 'Details' },
    { id: 3, label: mode === 'sn-to-sku' ? 'Log' : 'Print' },
  ];
}

interface BarcodeStepperProps {
  mode: BarcodeMode;
  /** Computed from form state: 1 = needs SKU, 2 = needs details, 3 = ready to print */
  activeStep: number;
  /** Click on a completed step to jump focus back. */
  onStepClick?: (step: number) => void;
}

/**
 * Horizontal segmented stepper for the desktop workspace. Mirrors the segmented
 * pill from {@link ModeSelector} but for progress within a mode. Pure visual;
 * does not own the step state — the parent derives it from form data.
 */
export function BarcodeStepper({ mode, activeStep, onStepClick }: BarcodeStepperProps) {
  const reduceMotion = useReducedMotion();
  const steps = stepsForMode(mode);

  return (
    <div className="border-b border-gray-100 bg-white px-7 py-3">
      <ol className="flex items-stretch gap-2">
        {steps.map((step, index) => {
          const isCompleted = activeStep > step.id;
          const isActive = activeStep === step.id;
          const isClickable = !!onStepClick && isCompleted;

          return (
            <React.Fragment key={step.id}>
              <li className="flex flex-1 items-center gap-2.5">
                <button
                  type="button"
                  onClick={isClickable ? () => onStepClick!(step.id) : undefined}
                  disabled={!isClickable}
                  className={`group relative flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
                    isClickable ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="stepper-active-bar"
                      className="absolute inset-x-3 -bottom-3 h-0.5 rounded-full bg-blue-600"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', damping: 28, stiffness: 360, mass: 0.6 }
                      }
                    />
                  )}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-black tabular-nums transition-colors ${
                      isCompleted
                        ? 'bg-blue-600 text-white'
                        : isActive
                          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {isCompleted ? <Check className="h-3 w-3" /> : step.id}
                  </span>
                  <span
                    className={`truncate text-caption font-black uppercase tracking-[0.16em] ${
                      isActive
                        ? 'text-gray-900'
                        : isCompleted
                          ? 'text-gray-600'
                          : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </button>
              </li>

              {index < steps.length - 1 && (
                <span
                  className={`my-auto h-px flex-1 max-w-[60px] ${
                    activeStep > step.id ? 'bg-blue-300' : 'bg-gray-200'
                  }`}
                  aria-hidden
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </div>
  );
}
