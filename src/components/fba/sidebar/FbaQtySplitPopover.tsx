'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { DeferredQtyInput } from '@/design-system/primitives';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { microBadge } from '@/design-system/tokens/typography/presets';

interface FbaQtySplitPopoverProps {
  itemId: number;
  fnsku: string;
  maxQty: number;
  onConfirm: (moveQty: number) => void;
  onCancel: () => void;
}

export function FbaQtySplitPopover({
  itemId,
  fnsku,
  maxQty,
  onConfirm,
  onCancel,
}: FbaQtySplitPopoverProps) {
  const [moveQty, setMoveQty] = useState(maxQty);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <motion.div
      ref={containerRef}
      initial={framerPresence.dropdownPanel.initial}
      animate={framerPresence.dropdownPanel.animate}
      exit={framerPresence.dropdownPanel.exit}
      transition={framerTransition.dropdownOpen}
      className="absolute inset-x-0 top-0 z-30 mx-2 rounded-lg border border-blue-200 bg-white p-3 shadow-lg"
    >
      <p className={`${microBadge} mb-2 tracking-wider text-gray-600`}>
        Move how many? <span className="font-mono text-gray-900">{fnsku}</span>
      </p>

      <div className="flex items-center gap-2">
        <DeferredQtyInput
          value={moveQty}
          min={1}
          max={maxQty}
          onChange={setMoveQty}
          className="h-8 w-16 rounded-md border border-gray-200 bg-white text-center text-[13px] font-black tabular-nums outline-none"
        />
        <span className={`${microBadge} text-gray-400`}>of {maxQty}</span>
      </div>

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => onConfirm(moveQty)}
          className="flex h-7 flex-1 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700"
        >
          Move
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-7 flex-1 items-center justify-center rounded-md border border-gray-200 text-[10px] font-bold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
