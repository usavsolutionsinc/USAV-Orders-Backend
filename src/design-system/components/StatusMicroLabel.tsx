'use client';

import { UnderlineValue } from './UnderlineValue';

type StatusTone = 'neutral' | 'blue' | 'orange' | 'red' | 'green' | 'purple' | 'yellow';

const statusToneMap: Record<string, StatusTone> = {
  active: 'green',
  confirmed: 'blue',
  shipped: 'purple',
  delivered: 'green',
  success: 'green',
  warning: 'yellow',
  overdue: 'red',
  error: 'red',
  danger: 'red',
  out_of_stock: 'red',
  low_stock: 'orange',
  queued: 'yellow',
  pending: 'yellow',
  logistics: 'blue',
  fulfillment: 'purple',
  repair: 'orange',
  inactive: 'neutral',
};

interface StatusMicroLabelProps {
  status: string;
  label?: string;
  className?: string;
}

function normalize(status: string) {
  return String(status || '').trim().toLowerCase();
}

function toLabel(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusMicroLabel({ status, label, className = '' }: StatusMicroLabelProps) {
  const normalized = normalize(status);
  const tone = statusToneMap[normalized] || 'neutral';
  const resolvedLabel = label || toLabel(normalized || 'Unknown');

  return (
    <UnderlineValue
      value={<span className="text-[9px] font-black uppercase tracking-[0.08em] leading-none">{resolvedLabel}</span>}
      tone={tone}
      className={className}
      truncate={false}
    />
  );
}
