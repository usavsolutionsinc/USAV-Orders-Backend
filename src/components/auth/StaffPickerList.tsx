'use client';

/**
 * Row-layout staff picker shared between /signin and the FAB SwitchStaffSheet.
 *
 * Visual identity:
 *   • Avatar circle filled with the staff's theme color
 *   • Name + role in muted UPPERCASE
 *   • "No PIN" amber pill when the staff hasn't enrolled
 *   • "RECENT" group on top, "ALL STAFF" below (drives by `recent` prop)
 *   • Per-staff theme accents on hover (background tint + ring + chevron color)
 */

import { useEffect, useMemo, useState } from 'react';
import { getStaffTheme, getStaffColorHex, type StationTheme } from '@/utils/staff-colors';
import { SkeletonBase } from '@/design-system/components/Skeletons';

export type StaffRow = { id: number; name: string; role: string; has_pin: boolean; color_hex: string };

interface StaffPickerListProps {
  /** Staff that should appear at the top under a "RECENT" header. */
  recent?: number[];
  /** Called when a staff is tapped. Disabled rows (no PIN) are intercepted. */
  onPick: (s: StaffRow) => void;
  /** Optional error display when a no-PIN row is tapped. */
  onMessage?: (msg: string | null) => void;
}

const THEME_ROW: Record<StationTheme, {
  hoverBg: string;
  hoverRing: string;
  chevron: string;
  avatarRing: string;
  recentDot: string;
  nameHover: string;
}> = {
  green:     { hoverBg: 'hover:bg-emerald-50',  hoverRing: 'hover:ring-emerald-200', chevron: 'text-emerald-600', avatarRing: 'ring-emerald-100',  recentDot: 'bg-emerald-400',  nameHover: 'group-hover:text-emerald-900' },
  blue:      { hoverBg: 'hover:bg-blue-50',     hoverRing: 'hover:ring-blue-200',    chevron: 'text-blue-600',    avatarRing: 'ring-blue-100',     recentDot: 'bg-blue-400',     nameHover: 'group-hover:text-blue-900' },
  purple:    { hoverBg: 'hover:bg-purple-50',   hoverRing: 'hover:ring-purple-200',  chevron: 'text-purple-600',  avatarRing: 'ring-purple-100',   recentDot: 'bg-purple-400',   nameHover: 'group-hover:text-purple-900' },
  yellow:    { hoverBg: 'hover:bg-amber-50',    hoverRing: 'hover:ring-amber-200',   chevron: 'text-amber-600',   avatarRing: 'ring-amber-100',    recentDot: 'bg-amber-400',    nameHover: 'group-hover:text-amber-900' },
  black:     { hoverBg: 'hover:bg-slate-100',   hoverRing: 'hover:ring-slate-300',   chevron: 'text-slate-700',   avatarRing: 'ring-slate-200',    recentDot: 'bg-slate-500',    nameHover: 'group-hover:text-slate-900' },
  red:       { hoverBg: 'hover:bg-red-50',      hoverRing: 'hover:ring-red-200',     chevron: 'text-red-600',     avatarRing: 'ring-red-100',      recentDot: 'bg-red-400',      nameHover: 'group-hover:text-red-900' },
  lightblue: { hoverBg: 'hover:bg-sky-50',      hoverRing: 'hover:ring-sky-200',     chevron: 'text-sky-600',     avatarRing: 'ring-sky-100',      recentDot: 'bg-sky-400',      nameHover: 'group-hover:text-sky-900' },
  pink:      { hoverBg: 'hover:bg-pink-50',     hoverRing: 'hover:ring-pink-200',    chevron: 'text-pink-600',    avatarRing: 'ring-pink-100',     recentDot: 'bg-pink-400',     nameHover: 'group-hover:text-pink-900' },
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function StaffPickerList({ recent = [], onPick, onMessage }: StaffPickerListProps) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/auth/staff-picker', { cache: 'no-store' });
        if (r.ok) {
          const data = (await r.json()) as { staff: StaffRow[] };
          if (!cancelled) setStaff(data.staff || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { recentRows, otherRows } = useMemo(() => {
    const map = new Map(staff.map((s) => [s.id, s] as const));
    const recents: StaffRow[] = [];
    for (const id of recent) {
      const hit = map.get(id);
      if (hit) { recents.push(hit); map.delete(id); }
    }
    return { recentRows: recents, otherRows: Array.from(map.values()) };
  }, [staff, recent]);

  if (loading) return <StaffPickerSkeleton />;
  if (staff.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500">
        No active staff. Ask an admin to add you.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {recentRows.length > 0 && (
        <Group label="Recent">
          {recentRows.map((s) => (
            <Row key={s.id} staff={s} onPick={onPick} onMessage={onMessage} isRecent />
          ))}
        </Group>
      )}
      <Group label={recentRows.length > 0 ? 'All staff' : undefined}>
        {otherRows.map((s) => (
          <Row key={s.id} staff={s} onPick={onPick} onMessage={onMessage} />
        ))}
      </Group>
    </div>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && (
        <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
          {label}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm shadow-sm shadow-gray-900/[0.03]">
        {children}
      </div>
    </div>
  );
}

interface RowProps {
  staff: StaffRow;
  onPick: (s: StaffRow) => void;
  onMessage?: (msg: string | null) => void;
  isRecent?: boolean;
}

function Row({ staff: s, onPick, onMessage, isRecent }: RowProps) {
  const theme = getStaffTheme(s);
  const t = THEME_ROW[theme];
  const needsSetup = !s.has_pin;
  return (
    <button
      type="button"
      onClick={() => {
        onMessage?.(null);
        onPick(s);
      }}
      className={`group flex w-full cursor-pointer items-center gap-3 border-b border-gray-100 px-3.5 py-3 text-left ring-1 ring-transparent transition-all duration-150 last:border-b-0 ${t.hoverBg} ${t.hoverRing}`}
      aria-label={needsSetup ? `Set up PIN for ${s.name}, ${s.role}` : `Sign in as ${s.name}, ${s.role}`}
    >
      <div className="relative flex-shrink-0">
        {isRecent && (
          <span className={`absolute -right-0.5 -top-0.5 z-[1] h-2.5 w-2.5 rounded-full ${t.recentDot} ring-2 ring-white`} aria-hidden />
        )}
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full text-[14px] font-bold text-white ring-4 ${t.avatarRing} transition-transform duration-150 group-hover:scale-[1.04]`}
          style={{ backgroundColor: getStaffColorHex(s) }}
        >
          {initials(s.name)}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[15px] font-semibold text-gray-900 transition-colors ${t.nameHover}`}>{s.name}</div>
        <div className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500">
          {s.role.replace(/_/g, ' ')}
          {needsSetup && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold tracking-normal text-blue-700 ring-1 ring-inset ring-blue-100">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              Tap to set up
            </span>
          )}
        </div>
      </div>
      <svg
        className={`h-4 w-4 flex-shrink-0 transition-all group-hover:translate-x-0.5 ${t.chevron}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      >
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </button>
  );
}

function StaffPickerSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm shadow-sm shadow-gray-900/[0.03]">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex w-full items-center gap-3 border-b border-gray-100 px-3.5 py-3 last:border-b-0"
        >
          <SkeletonBase circle width="44px" height="44px" className="flex-shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBase width="35%" height="0.95rem" />
            <SkeletonBase width="22%" height="0.6rem" />
          </div>
          <SkeletonBase width="16px" height="16px" className="flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

// Re-export the row type for callers that need it.
export type { StaffRow as StaffPickerRow };
