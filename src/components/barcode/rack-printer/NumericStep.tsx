import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { noPad, pad2 } from '@/lib/barcode-routing';

interface NumericStepProps {
  title: string;
  count: number;
  selected?: number;
  onPick: (n: number) => void;
  customLabel?: string;
  hint?: string;
  unpadded?: boolean;
}

const NUMERIC_QUICK_PICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Quick-pick 1–9 grid + a custom (10–99) stepper input for one numeric step. */
export function NumericStep({
  title, count, selected, onPick, hint, unpadded,
  customLabel = 'Custom #',
}: NumericStepProps) {
  const format = unpadded ? noPad : pad2;
  const isCustomSelected = selected != null && selected > 9;
  const customPlaceholder = '10+';
  const reduceMotion = useReducedMotion();

  const [custom, setCustom] = useState('');
  const customNum = parseInt(custom, 10);
  const customValid = Number.isFinite(customNum) && customNum >= 1 && customNum <= 99;

  const confirmCustom = () => {
    if (!customValid) return;
    onPick(customNum);
    setCustom('');
  };

  const stepBy = (delta: number) => {
    if (!customValid) {
      setCustom('10');
      return;
    }
    const next = Math.min(99, Math.max(1, customNum + delta));
    setCustom(String(next));
  };

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={title}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      >
        <div className={`flex items-baseline justify-between ${hint ? 'mb-1' : 'mb-3'}`}>
          <h3 className="text-base font-semibold tracking-tight text-text-default">{title}</h3>
          <span className="text-micro font-medium tabular-nums text-text-faint">up to {count}</span>
        </div>

        {hint && <p className="mb-3 text-[11.5px] leading-snug text-text-soft">{hint}</p>}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {NUMERIC_QUICK_PICKS.map((n) => {
            const isSelected = selected === n;
            return (
              // ds-raw-button: numpad quick-pick tile — fixed grid sizing, gradient-selected
              <button
                key={n}
                type="button"
                onClick={() => onPick(n)}
                className={`relative flex h-16 flex-col items-center justify-center rounded-2xl border text-center transition-all active:scale-[0.97] ${
                  isSelected
                    ? 'border-transparent bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                    : 'border-border-soft bg-surface-card text-text-default hover:border-border-default hover:bg-surface-hover'
                }`}
              >
                <span className="font-mono text-lg font-semibold tabular-nums tracking-tight">{format(n)}</span>
              </button>
            );
          })}

          <div
            className={`relative flex h-16 items-center rounded-2xl border border-dashed bg-surface-card pl-3 pr-1 transition-colors ${
              isCustomSelected
                ? 'border-blue-300 ring-2 ring-blue-200'
                : 'border-border-default focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
            }`}
            aria-label={customLabel}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCustom();
                if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-1); }
              }}
              placeholder={customPlaceholder}
              aria-label={customLabel}
              className="h-full w-full min-w-0 bg-transparent pr-1 text-center font-mono text-lg font-semibold tabular-nums tracking-tight text-text-default outline-none placeholder:text-label placeholder:font-medium placeholder:tracking-wide placeholder:text-text-faint [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />

            <div className="ml-1 flex h-12 shrink-0 flex-col justify-center gap-0.5">
              <IconButton
                type="button"
                onClick={() => stepBy(1)}
                ariaLabel="Increment"
                className="flex h-[22px] w-7 items-center justify-center rounded-md hover:bg-surface-sunken"
                icon={<ChevronUp className="h-3.5 w-3.5" />}
              />
              <IconButton
                type="button"
                onClick={() => stepBy(-1)}
                ariaLabel="Decrement"
                className="flex h-[22px] w-7 items-center justify-center rounded-md hover:bg-surface-sunken"
                icon={<ChevronDown className="h-3.5 w-3.5" />}
              />
            </div>

            <IconButton
              type="button"
              onClick={confirmCustom}
              disabled={!customValid}
              ariaLabel={`Confirm ${customLabel.toLowerCase()}`}
              className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm disabled:bg-surface-strong disabled:bg-none disabled:text-text-faint disabled:shadow-none"
              icon={<Check className="h-4 w-4" />}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
