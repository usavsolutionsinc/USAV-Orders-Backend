import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system';
import { Package } from '@/components/Icons';

export function EmptySlate({ label, color = 'gray' }: { label: string; color?: 'gray' | 'green' | 'purple' | 'teal' | 'red' }) {
  const bg   = color === 'green' ? 'bg-emerald-50 border-emerald-100' : color === 'purple' ? 'bg-purple-50 border-purple-100' : color === 'teal' ? 'bg-teal-50 border-teal-100' : color === 'red' ? 'bg-red-50 border-red-100' : 'bg-surface-canvas border-border-soft';
  const text = color === 'green' ? 'text-emerald-500' : color === 'purple' ? 'text-purple-500' : color === 'teal' ? 'text-teal-500' : color === 'red' ? 'text-red-500' : 'text-text-soft';
  const icon = color === 'green' ? 'text-emerald-300' : color === 'purple' ? 'text-purple-200' : color === 'teal' ? 'text-teal-200' : color === 'red' ? 'text-red-200' : 'text-text-soft';
  return (
    <motion.div
      {...framerPresence.upNextRow}
      transition={framerTransition.upNextRowMount}
      className={`rounded-2xl px-4 py-3 border ${bg}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-bold uppercase tracking-widest ${text}`}>{label}</p>
        <Package className={`w-5 h-5 flex-shrink-0 ${icon}`} />
      </div>
    </motion.div>
  );
}

export function SectionHeader({ label, color = 'orange' }: { label: string; color?: 'orange' | 'purple' | 'red' }) {
  const lineClass = color === 'purple' ? 'bg-purple-200' : color === 'red' ? 'bg-red-200' : 'bg-orange-200';
  const textClass = color === 'purple' ? 'text-purple-600' : color === 'red' ? 'text-red-600' : 'text-orange-600';
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
      <div className={`h-px flex-1 ${lineClass}`} />
      <span className={`text-eyebrow font-black uppercase tracking-widest ${textClass}`}>
        {label}
      </span>
      <div className={`h-px flex-1 ${lineClass}`} />
    </div>
  );
}
