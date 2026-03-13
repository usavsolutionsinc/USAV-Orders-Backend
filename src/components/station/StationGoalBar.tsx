'use client';

import { motion } from 'framer-motion';

interface StationGoalBarProps {
  count: number;
  goal: number;
  label: string;
  remainingLabel?: string;
  colorClass: string;
}

export default function StationGoalBar({
  count,
  goal,
  label,
  remainingLabel = 'Left',
  colorClass,
}: StationGoalBarProps) {
  const safeGoal = Math.max(1, Number(goal) || 1);
  const progressPercent = Math.min((count / safeGoal) * 100, 100);
  const remaining = Math.max(safeGoal - count, 0);

  return (
    <div className="space-y-1.5 px-1">
      <div className="flex items-center justify-between">
        <p className={`text-[9px] font-black ${colorClass} tabular-nums`}>{count}/{safeGoal} {label}</p>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{remaining} {remainingLabel}</p>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progressPercent}%` }}
          className={`h-full ${colorClass.replace('text-', 'bg-')} rounded-full`}
        />
      </div>
    </div>
  );
}
