'use client';

import { motion } from 'framer-motion';
import type { ReactNode, MouseEvent } from 'react';

type Tone = 'gray' | 'orange' | 'emerald' | 'purple';
type Size = 'sm' | 'md';

interface UpNextActionButtonProps {
  label: string;
  icon?: ReactNode;
  tone?: Tone;
  size?: Size;
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

const TONE_CLASSES: Record<Tone, string> = {
  gray: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100',
  orange: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100',
  emerald: 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(6,95,70,0.34)]',
  purple: 'border-purple-700 bg-purple-600 text-white hover:bg-purple-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(88,28,135,0.34)]',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'min-h-[38px] rounded-lg text-[9px] tracking-[0.16em]',
  md: 'min-h-[44px] rounded-xl text-[10px] tracking-widest',
};

export function UpNextActionButton({
  label,
  icon,
  tone = 'gray',
  size = 'md',
  disabled = false,
  fullWidth = false,
  onClick,
  className = '',
  type = 'button',
}: UpNextActionButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={`inline-flex items-center justify-center gap-1.5 border font-black uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        fullWidth ? 'w-full' : ''
      } ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}
