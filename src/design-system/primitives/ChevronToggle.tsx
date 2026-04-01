'use client';

import { motion } from 'framer-motion';
import { useUIModeOptional } from '../providers/UIModeProvider';
import { framerTransition } from '../foundations/motion-framer';
import { ChevronDown } from '@/components/Icons';

interface ChevronToggleProps {
  isExpanded: boolean;
  tone?: 'emerald' | 'orange' | 'purple' | 'gray';
  className?: string;
}

const TONE_CLASSES: Record<string, string> = {
  emerald: 'border-emerald-200 text-emerald-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(34,197,94,0.16)]',
  orange:  'border-orange-200 text-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(234,88,12,0.16)]',
  purple:  'border-purple-200 text-purple-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(147,51,234,0.16)]',
  gray:    'border-gray-200 text-gray-500 shadow-sm',
};

export function ChevronToggle({ isExpanded, tone = 'emerald', className = '' }: ChevronToggleProps) {
  const { isMobile } = useUIModeOptional();

  return (
    <motion.span
      animate={{ rotate: isExpanded ? 180 : 0 }}
      transition={framerTransition.upNextChevron}
      className={`inline-flex items-center justify-center rounded-full border ${TONE_CLASSES[tone]} ${
        isMobile
          ? 'h-11 w-11 active:scale-95 transition-transform'
          : 'h-8 w-8'
      } ${className}`}
    >
      <ChevronDown className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
    </motion.span>
  );
}
