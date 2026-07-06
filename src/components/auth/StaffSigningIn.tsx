'use client';

import { getStaffColorHex, getStaffTheme } from '@/utils/staff-colors';

interface StaffSigningInProps {
  staff: { name: string; color_hex?: string };
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

/** Shown after a pinless tap while the session is being created. */
export function StaffSigningIn({ staff }: StaffSigningInProps) {
  const theme = getStaffTheme(staff);
  const ring =
    theme === 'green' ? 'ring-emerald-100'
    : theme === 'blue' ? 'ring-blue-100'
    : theme === 'purple' ? 'ring-purple-100'
    : theme === 'yellow' ? 'ring-amber-100'
    : theme === 'red' ? 'ring-red-100'
    : theme === 'lightblue' ? 'ring-sky-100'
    : theme === 'pink' ? 'ring-pink-100'
    : 'ring-border-soft';

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white ring-4 ${ring}`}
        style={{ backgroundColor: getStaffColorHex(staff) }}
      >
        {initials(staff.name)}
      </div>
      <div>
        <p className="text-lg font-semibold tracking-tight text-text-default">Signing in as {staff.name}</p>
        <p className="mt-1.5 text-sm text-text-soft">One moment…</p>
      </div>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-soft border-t-text-muted" aria-hidden />
    </div>
  );
}
