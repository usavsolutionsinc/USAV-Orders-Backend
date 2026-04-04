'use client';

import { Minus, Plus } from '@/components/Icons';
import { DeferredQtyInput } from '@/design-system/primitives';

export interface FbaQtyStepperProps {
  value: number;
  onChange: (next: number) => void;
  /** FNSKU for accessible labels (optional). */
  fnsku?: string;
  /** Red styling when qty is at or below this threshold (default: 0). */
  dangerThreshold?: number;
  /** Amber styling when qty exceeds this (used in paired review). */
  warnAbove?: number;
}

/**
 * Vertical Plus / Input / Minus qty stepper used across the FBA sidebar.
 *
 * Replaces the triplicated JSX in FbaPairedReviewPanel, TrackingGroup,
 * and FbaShipmentCard.
 */
export function FbaQtyStepper({
  value,
  onChange,
  fnsku,
  dangerThreshold = 0,
  warnAbove,
}: FbaQtyStepperProps) {
  const isDanger = value <= dangerThreshold;
  const isWarn = warnAbove !== undefined && value > warnAbove;

  const inputBorder = isWarn
    ? 'border-amber-300 text-amber-700'
    : isDanger
      ? 'border-red-300 text-red-500'
      : 'border-gray-200 text-gray-900';

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(value + 1); }}
        className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
        aria-label={fnsku ? `Increase ${fnsku} quantity` : 'Increase quantity'}
      >
        <Plus className="h-3 w-3" />
      </button>
      <DeferredQtyInput
        value={value}
        min={0}
        onChange={(v) => onChange(Math.max(0, v))}
        onClick={(e) => e.stopPropagation()}
        className={`h-7 w-10 border-x bg-white text-center text-[12px] font-black tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${inputBorder}`}
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(value - 1); }}
        disabled={value <= 0}
        className={`flex h-6 w-10 items-center justify-center rounded-b-md border transition-colors ${
          value <= 1
            ? 'border-red-300 text-red-500 hover:bg-red-50'
            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
        } disabled:opacity-40`}
        aria-label={fnsku ? `Decrease ${fnsku} quantity` : 'Decrease quantity'}
      >
        <Minus className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Read-only qty display (used in non-editable shipment cards). */
export function FbaQtyDisplay({ value }: { value: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center text-center px-2">
      <span className="text-[14px] font-black tabular-nums text-gray-900">{value}</span>
      <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">qty</span>
    </div>
  );
}
