import React from 'react';
import { cn } from '@/utils/_cn';

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'
  | 'repair'
  | 'logistics'
  | 'fulfillment'
  | 'queued'
  | 'navy';

const VARIANT_MAP: Record<BadgeVariant, { dot: string; text: string; bg: string }> = {
  success:     { dot: 'bg-green-500',   text: 'text-green-700',  bg: 'bg-green-50' },
  warning:     { dot: 'bg-orange-400',  text: 'text-orange-700', bg: 'bg-orange-50' },
  danger:      { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50' },
  info:        { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50' },
  muted:       { dot: 'bg-gray-400',    text: 'text-gray-500',   bg: 'bg-gray-100' },
  repair:      { dot: 'bg-orange-500',  text: 'text-orange-700', bg: 'bg-orange-50' },
  logistics:   { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50' },
  fulfillment: { dot: 'bg-purple-500',  text: 'text-purple-700', bg: 'bg-purple-50' },
  queued:      { dot: 'bg-yellow-400',  text: 'text-yellow-700', bg: 'bg-yellow-50' },
  navy:        { dot: 'bg-navy-700',    text: 'text-navy-800',   bg: 'bg-navy-50' },
};

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  className?: string;
}

export function StatusBadge({ label, variant = 'muted', className }: StatusBadgeProps) {
  const v = VARIANT_MAP[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full',
        v.bg,
        className,
      )}
    >
      <span className={cn('w-[5px] h-[5px] rounded-full shrink-0', v.dot)} />
      <span className={cn('text-[9px] font-bold tracking-[0.12em] uppercase font-sans', v.text)}>
        {label}
      </span>
    </span>
  );
}
