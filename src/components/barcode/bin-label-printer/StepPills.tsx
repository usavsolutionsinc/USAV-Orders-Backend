import { Fragment, useRef } from 'react';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { noPad, pad2 } from '@/lib/barcode-routing';
import { STEPS, type Step } from './index';

interface StepPillsProps {
  activeStep: Step;
  zoneLetter?: string;
  roomName?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
  onPillClick: (step: Step) => void;
}

/** Horizontal zone → aisle → bay → level → position breadcrumb pills. */
export function StepPills({ activeStep, zoneLetter, roomName, aisle, bay, level, position, onPillClick }: StepPillsProps) {
  const values: Record<Step, string | undefined> = {
    zone: zoneLetter,
    aisle: aisle != null ? pad2(aisle) : undefined,
    bay: bay != null ? pad2(bay) : undefined,
    level: level != null ? noPad(level) : undefined,
    position: position != null ? pad2(position) : undefined,
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(scrollRef);

  return (
    <div
      ref={scrollRef}
      className="flex w-full min-w-0 overflow-x-scroll overflow-y-hidden overscroll-x-contain rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-200/60 [-ms-overflow-style:none] [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      role="navigation"
      aria-label="Bin location steps"
    >
      <div className="flex w-max max-w-none flex-none flex-nowrap items-center gap-1">
        {STEPS.map(({ id, label }, idx) => {
          const value = values[id];
          const isDone = !!value;
          const isActive = activeStep === id;
          const isClickable = isDone || isActive;
          const showChevron = idx < STEPS.length - 1;
          const tip = id === 'zone' && roomName ? roomName : '';
          const pill = (
            <button
              type="button"
              onClick={() => onPillClick(id)}
              disabled={!isClickable}
              aria-current={isActive ? 'step' : undefined}
              className={`ds-raw-button flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition-all active:scale-95 ${
                isActive
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : isDone
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <span className="text-micro uppercase tracking-wider opacity-80">{label}</span>
              <span className="font-mono text-micro font-semibold tabular-nums">{value ?? '—'}</span>
            </button>
          );
          return (
            <Fragment key={id}>
              {tip ? (
                <HoverTooltip label={tip} asChild>
                  {pill}
                </HoverTooltip>
              ) : (
                pill
              )}
              {showChevron && <span className="shrink-0 text-micro text-gray-300">›</span>}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
