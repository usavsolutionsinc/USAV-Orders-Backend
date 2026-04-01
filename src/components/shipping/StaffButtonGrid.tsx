'use client';

import { motion } from 'framer-motion';
import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';
import { framerGesture } from '@/design-system/foundations/motion-framer';
import { fieldLabel } from '@/design-system/tokens/typography/presets';

export interface StaffOption {
  id: number;
  name: string;
}

interface StaffButtonGridProps {
  label: string;
  options: StaffOption[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  columns?: number;
  emptyMessage?: string;
  className?: string;
}

export function StaffButtonGrid({
  label,
  options,
  selectedId,
  onSelect,
  columns,
  emptyMessage = 'None available',
  className,
}: StaffButtonGridProps) {
  const cols = columns ?? options.length;

  return (
    <div className={className}>
      <p className="mb-2 text-[9px] font-black uppercase tracking-[0.22em] text-gray-500">{label}</p>
      {options.length > 0 ? (
        <div
          className="grid w-full gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}
        >
          {options.map((m) => {
            const active = selectedId === m.id;
            const cls = stationThemeClasses[getStaffThemeById(m.id)];
            return (
              <motion.button
                key={m.id}
                type="button"
                whileTap={framerGesture.tapPress}
                onClick={() => onSelect(m.id)}
                className={[
                  'touch-manipulation flex h-11 w-full min-w-0 flex-col items-center justify-center rounded-lg border-2 px-2 transition-all active:scale-[0.98]',
                  active ? `${cls.active} border-transparent shadow-lg` : cls.inactive,
                ].join(' ')}
              >
                <span className="w-full text-center text-[10px] font-black uppercase leading-tight tracking-[0.04em]">
                  {m.name}
                </span>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <p className={`${fieldLabel} text-gray-500`}>{emptyMessage}</p>
      )}
    </div>
  );
}
