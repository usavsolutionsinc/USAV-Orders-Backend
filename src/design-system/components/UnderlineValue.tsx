'use client';

import type { ReactNode } from 'react';

type UnderlineTone = 'neutral' | 'blue' | 'orange' | 'red' | 'green' | 'purple' | 'yellow';

const toneClasses: Record<UnderlineTone, string> = {
  neutral: 'border-border-emphasis text-text-default',
  blue: 'border-blue-500 text-text-default',
  orange: 'border-orange-500 text-text-default',
  red: 'border-red-500 text-text-default',
  green: 'border-green-500 text-text-default',
  purple: 'border-purple-500 text-text-default',
  yellow: 'border-yellow-500 text-text-default',
};

interface UnderlineValueProps {
  value: ReactNode;
  tone?: UnderlineTone;
  monospace?: boolean;
  className?: string;
  truncate?: boolean;
}

export function UnderlineValue({
  value,
  tone = 'neutral',
  monospace = false,
  className = '',
  truncate = true,
}: UnderlineValueProps) {
  return (
    <span
      className={[
        'inline-block border-b-2 pb-0.5 text-sm font-bold leading-none',
        monospace ? 'font-mono' : '',
        truncate ? 'max-w-full truncate' : '',
        toneClasses[tone],
        className,
      ].join(' ').trim()}
    >
      {value}
    </span>
  );
}
