'use client';

import { Check } from '@/components/Icons';
import { cn } from '@/utils/_cn';

export interface StaffRecipient {
  id: number;
  name: string;
  role: string;
  color_hex: string;
}

interface StaffRecipientListProps {
  staff: ReadonlyArray<StaffRecipient>;
  onPick: (staff: StaffRecipient) => void;
  currentStaffId?: number | null;
  emptyLabel?: string;
  title?: string;
  className?: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function StaffRecipientList({
  staff,
  onPick,
  currentStaffId,
  emptyLabel = 'No other staff to send to.',
  title = 'Send to…',
  className = '',
}: StaffRecipientListProps) {
  if (staff.length === 0) {
    return <p className={cn('px-1 py-2 text-center text-micro italic text-gray-400', className)}>{emptyLabel}</p>;
  }

  return (
    <div className={cn('max-h-[180px] overflow-y-auto', className)}>
      <p className="px-1 pb-1 text-micro font-black uppercase tracking-widest text-gray-500">
        {title}
      </p>
      <ul className="space-y-1">
        {staff.map((s) => {
          const active = s.id === currentStaffId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-blue-50' : 'hover:bg-white active:bg-gray-100',
                )}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-eyebrow font-black text-white"
                  style={{ backgroundColor: s.color_hex || '#10b981' }}
                >
                  {initials(s.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-label font-bold text-gray-900">
                  {s.name}
                </span>
                <span className="shrink-0 text-micro uppercase tracking-wide text-gray-400">
                  {s.role}
                </span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
