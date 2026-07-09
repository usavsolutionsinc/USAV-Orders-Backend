'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Button, DeferredQtyInput } from '@/design-system/primitives';
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
      className="absolute inset-x-0 top-0 z-dropdown mx-2 rounded-lg border border-blue-200 bg-surface-card p-3 shadow-lg"
    >
      <p className={`${microBadge} mb-2 tracking-wider text-text-muted`}>
        Move how many? <span className="font-mono text-text-default">{fnsku}</span>
      </p>

      <div className="flex items-center gap-2">
        <DeferredQtyInput
          value={moveQty}
          min={1}
          max={maxQty}
          onChange={setMoveQty}
          className="h-8 w-16 rounded-md border border-border-soft bg-surface-card text-center text-sm font-black tabular-nums outline-none"
        />
        <span className={`${microBadge} text-text-faint`}>of {maxQty}</span>
      </div>

      <div className="mt-2.5 flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onConfirm(moveQty)}
          className="h-7 flex-1 text-micro font-bold uppercase tracking-wider"
        >
          Move
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          className="h-7 flex-1 text-micro font-bold uppercase tracking-wider text-text-muted"
        >
          Cancel
        </Button>
      </div>
    </motion.div>
  );
}
