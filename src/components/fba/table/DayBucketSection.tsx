'use client';

import { motion } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';
import { fbaPrintTableTokens as T } from './fbaPrintTableTokens';

export function DayBucketHeaderRow({
  label,
  summary,
  collapsed,
  onToggle,
  reducedMotion,
}: {
  label: string;
  summary: string;
  collapsed: boolean;
  onToggle: () => void;
  reducedMotion: boolean;
}) {
  return (
    <tr className={T.bucketRow}>
      <td colSpan={3} className="p-0">
        <button type="button" onClick={onToggle} className={T.bucketButton}>
          <motion.span
            animate={{ rotate: collapsed ? -90 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className={T.bucketChevron}
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
          <span className={T.bucketLabel}>{label}</span>
          <span className={T.bucketSummary}>{summary}</span>
        </button>
      </td>
    </tr>
  );
}
