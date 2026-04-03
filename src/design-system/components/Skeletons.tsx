'use client';

import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '../foundations/motion-framer';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

export function SkeletonBase({ className = '', width, height, circle }: SkeletonProps) {
  return (
    <div
      className={`bg-gray-200 animate-pulse ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
      style={{
        width: width ?? '100%',
        height: height ?? '1rem',
      }}
    />
  );
}

export function SkeletonRow() {
  return (
    <motion.div
      {...framerPresence.tableRow}
      transition={framerTransition.tableRowMount}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-2.5 border-b border-gray-100"
    >
      <div className="flex flex-col gap-2">
        <SkeletonBase width="60%" height="0.875rem" />
        <SkeletonBase width="40%" height="0.625rem" />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBase width="40px" height="20px" />
        <SkeletonBase width="60px" height="20px" />
        <SkeletonBase width="80px" height="20px" />
      </div>
    </motion.div>
  );
}

export function SkeletonOrderCard() {
  return (
    <motion.div
      {...framerPresence.upNextRow}
      transition={framerTransition.upNextRowMount}
      className="bg-white rounded-2xl border border-gray-100 p-4 mb-3 shadow-sm"
    >
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <SkeletonBase width="80px" height="20px" />
          <SkeletonBase width="40px" height="20px" />
        </div>
        <SkeletonBase width="60px" height="20px" />
      </div>
      
      <div className="space-y-3">
        <SkeletonBase width="90%" height="1.25rem" />
        <div className="flex gap-2">
          <SkeletonBase width="100px" height="32px" className="rounded-lg" />
          <SkeletonBase width="100px" height="32px" className="rounded-lg" />
        </div>
      </div>
    </motion.div>
  );
}

export function SkeletonList({ count = 5, type = 'row' }: { count?: number; type?: 'row' | 'card' }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        type === 'row' ? <SkeletonRow key={i} /> : <SkeletonOrderCard key={i} />
      ))}
    </div>
  );
}
