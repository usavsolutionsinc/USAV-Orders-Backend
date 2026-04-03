'use client';

import type { ReactNode } from 'react';

type InlineNoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
type InlineNoticeSize = 'sm' | 'md';

interface InlineNoticeProps {
  tone?: InlineNoticeTone;
  size?: InlineNoticeSize;
  title?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<InlineNoticeTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

const containerSizeClasses: Record<InlineNoticeSize, string> = {
  sm: 'rounded-lg px-3 py-2',
  md: 'rounded-xl px-4 py-3',
};

const titleSizeClasses: Record<InlineNoticeSize, string> = {
  sm: 'text-[9px] tracking-[0.14em]',
  md: 'text-[10px] tracking-[0.16em]',
};

const bodySizeClasses: Record<InlineNoticeSize, string> = {
  sm: 'text-[10px] leading-4',
  md: 'text-[11px] leading-5',
};

export function InlineNotice({
  tone = 'neutral',
  size = 'md',
  title,
  icon,
  children,
  className = '',
}: InlineNoticeProps) {
  return (
    <div className={`border ${toneClasses[tone]} ${containerSizeClasses[size]} ${className}`.trim()}>
      <div className="flex items-start gap-2">
        {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
        <div className="min-w-0">
          {title ? (
            <p className={`font-black uppercase ${titleSizeClasses[size]}`}>
              {title}
            </p>
          ) : null}
          <div className={`${bodySizeClasses[size]} font-medium ${title ? 'mt-1' : ''}`.trim()}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
