import { Minus, Plus } from '@/components/Icons';
import { DeferredQtyInput, IconButton } from '@/design-system/primitives';
import { PLAN_QTY_MAX } from '@/lib/fba/plan-helpers';

/**
 * Vertical +/qty/− stepper used in both the pending-today-plan queue and the
 * plan-preview list. The decrement button turns red once qty would drop to 0.
 */
export function FbaQtyStepper({
  fnsku,
  qty,
  onInc,
  onDec,
  onSet,
}: {
  fnsku: string;
  qty: number;
  onInc: () => void;
  onDec: () => void;
  onSet: (v: number) => void;
}) {
  return (
    <>
      <IconButton
        type="button"
        icon={<Plus className="h-3 w-3" />}
        ariaLabel={`Increase ${fnsku} quantity`}
        onClick={(e) => {
          e.stopPropagation();
          onInc();
        }}
        disabled={qty >= PLAN_QTY_MAX}
        className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 hover:bg-gray-50"
      />
      <DeferredQtyInput
        value={qty}
        min={0}
        max={PLAN_QTY_MAX}
        onChange={(v) => {
          onSet(v);
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-7 w-10 border-x border-gray-200 bg-white text-center text-sm font-black tabular-nums text-gray-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <IconButton
        type="button"
        icon={<Minus className="h-3 w-3" />}
        ariaLabel={`Decrease ${fnsku} quantity`}
        onClick={(e) => {
          e.stopPropagation();
          onDec();
        }}
        disabled={qty <= 0}
        className={`flex h-6 w-10 items-center justify-center rounded-b-md border ${
          qty <= 1
            ? 'border-red-300 text-red-500 hover:bg-red-50'
            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
        }`}
      />
    </>
  );
}
