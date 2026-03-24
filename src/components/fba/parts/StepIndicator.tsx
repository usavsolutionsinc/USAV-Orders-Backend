import { memo } from 'react';
import { motion } from 'framer-motion';

export type StepId = 'paste' | 'review' | 'form' | 'post-create';

const labels: Record<StepId, string> = {
  paste: 'Paste',
  review: 'Review',
  form: 'Create',
  'post-create': 'Done',
};

interface StepIndicatorProps {
  step: StepId;
  compact?: boolean;
}

export const StepIndicator = memo(function StepIndicator({ step, compact }: StepIndicatorProps) {
  const order: StepId[] = ['paste', 'review', 'form', 'post-create'];
  const idx = order.indexOf(step);

  return (
    <div className="fnsku-step-indicator flex items-center gap-1.5">
      {order.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <motion.div
            layout
            className="h-1.5 w-1.5 rounded-full"
            animate={{ backgroundColor: i <= idx ? '#7c3aed' : '#d4d4d8' }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          />
          {i < order.length - 1 && (
            <motion.div
              layout
              className="h-px w-4"
              animate={{ backgroundColor: i < idx ? '#a78bfa' : '#d4d4d8' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
        </div>
      ))}
      {!compact && (
        <span className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">{labels[step]}</span>
      )}
    </div>
  );
});
