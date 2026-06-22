'use client';

import type React from 'react';
import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system';
import { RowTitle, RowMetaColumns } from '@/components/ui/RowMetaColumns';
import { SOURCE_DOT_BG, SOURCE_DOT_LABEL, type SourceDotType } from '@/utils/source-dot';

/**
 * Shared station-row shell: zebra grid + source-dot title + qty/condition meta
 * + the chip grid. Tech and Packer rows render the SAME chrome (the only
 * difference: Packer rows animate on mount/hover, tech rows are static) — so the
 * markup lives here once. Pairs with `station-chip-columns.tsx`; together they
 * are the reusable core of the chassis `StationRecordRow`. Each row still owns
 * its record-specific derivation (dot inputs, title/condition, FNSKU source).
 */
export interface StationRecordShellProps {
  dotType: SourceDotType;
  title: string;
  quantity: number;
  condition: string;
  chipGrid: React.ReactNode;
  /** Row position — drives zebra striping. */
  index: number;
  onClick: () => void;
  /** Packer rows animate (mount + hover/tap); tech rows are static. */
  animated?: boolean;
}

export function StationRecordShell({
  dotType,
  title,
  quantity,
  condition,
  chipGrid,
  index,
  onClick,
  animated = false,
}: StationRecordShellProps) {
  const zebra = index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10';
  const body = (
    <>
      <div className="flex min-w-0 flex-col">
        <RowTitle dot={SOURCE_DOT_BG[dotType]} dotTitle={SOURCE_DOT_LABEL[dotType]} title={title} />
        <RowMetaColumns
          qty={<span className={quantity > 1 ? 'text-yellow-600' : undefined}>{quantity}</span>}
          condition={condition}
        />
      </div>
      {chipGrid}
    </>
  );

  if (animated) {
    return (
      <motion.div
        {...framerPresence.tableRow}
        transition={framerTransition.tableRowMount}
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.998 }}
        onClick={onClick}
        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-300 px-3 py-1.5 transition-all hover:bg-blue-50/40 ${zebra}`}
      >
        {body}
      </motion.div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-300 px-3 py-1.5 transition-colors hover:bg-blue-50/40 ${zebra}`}
    >
      {body}
    </div>
  );
}
