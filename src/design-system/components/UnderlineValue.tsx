'use client';

import type { ReactNode } from 'react';

type UnderlineTone = 'neutral' | 'blue' | 'orange' | 'red' | 'green' | 'purple' | 'yellow';

const toneClasses: Record<UnderlineTone, string> = {
  neutral: 'border-gray-400 text-slate-900',
  blue: 'border-blue-500 text-slate-900',
  orange: 'border-orange-500 text-slate-900',
  red: 'border-red-500 text-slate-900',
  green: 'border-green-500 text-slate-900',
  purple: 'border-purple-500 text-slate-900',
  yellow: 'border-yellow-500 text-slate-900',
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
        'inline-block border-b-2 pb-0.5 text-[13px] font-bold leading-none',
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
