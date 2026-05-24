'use client';

interface StatPillProps {
  label: string;
  value: number;
  tone?: 'gray' | 'green' | 'blue' | 'purple';
}

const TONE: Record<string, { bg: string; text: string; value: string }> = {
  gray:   { bg: 'bg-gray-100',    text: 'text-gray-600',    value: 'text-gray-900' },
  green:  { bg: 'bg-green-100',   text: 'text-green-700',   value: 'text-green-900' },
  blue:   { bg: 'bg-blue-100',    text: 'text-blue-700',    value: 'text-blue-900' },
  purple: { bg: 'bg-purple-100',  text: 'text-purple-700',  value: 'text-purple-900' },
};

export function StatPill({ label, value, tone = 'gray' }: StatPillProps) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium ${t.bg}`}>
      <span className={`uppercase tracking-wider ${t.text}`}>{label}</span>
      <span className={`tabular-nums font-bold ${t.value}`}>{value}</span>
    </span>
  );
}
