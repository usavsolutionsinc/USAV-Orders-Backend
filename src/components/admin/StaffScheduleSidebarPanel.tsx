'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import {
  AdminSidebarShell,
  AdminFilterChips,
  AdminPickerRow,
  useAdminUrlState,
} from '@/components/admin/shared';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { getStaffColorHex } from '@/utils/staff-colors';

type StaffViewMode = 'all' | 'active' | 'inactive' | 'technician' | 'packer';

interface StaffRow {
  id: number;
  name: string;
  role: string;
  active: boolean;
  employee_id: string | null;
  color_hex?: string | null;
}

const STAFF_VIEW_OPTIONS = [
  { value: 'all' as StaffViewMode, label: 'All' },
  { value: 'active' as StaffViewMode, label: 'Active' },
  { value: 'inactive' as StaffViewMode, label: 'Inactive' },
] as const;

const ROLE_OPTIONS = [
  { value: 'all' as StaffViewMode, label: 'All roles' },
  { value: 'technician' as StaffViewMode, label: 'Tech' },
  { value: 'packer' as StaffViewMode, label: 'Pack' },
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Sidebar picker for Admin → Staff schedule. Roster CRUD lives in Settings → Team.
 */
export function StaffScheduleSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const staffView = (searchParams.get('staffView') as StaffViewMode) || 'all';
  const selectedStaffId = (() => {
    const raw = searchParams.get('staffId');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const { data: staff = [], isLoading } = useQuery<StaffRow[]>({
    queryKey: qk.staff.all,
    queryFn: async () => {
      const res = await fetch('/api/staff?active=false');
      if (!res.ok) throw new Error('Failed to load staff');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((m) => {
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.employee_id ?? '').toLowerCase().includes(q);
      const matchesView =
        staffView === 'active'
          ? Boolean(m.active)
          : staffView === 'inactive'
            ? !m.active
            : staffView === 'technician'
              ? m.role === 'technician'
              : staffView === 'packer'
                ? m.role === 'packer'
                : true;
      return matchesSearch && matchesView;
    });
  }, [staff, search, staffView]);

  const setStaffView = (next: StaffViewMode) => {
    setParam((p) => {
      p.set('section', 'staff_schedule');
      if (next === 'all') p.delete('staffView');
      else p.set('staffView', next);
    });
  };

  return (
    <AdminSidebarShell
      search={{
        value: search,
        onChange: (v) =>
          setParam((p) => {
            p.set('section', 'staff_schedule');
            if (v.trim()) p.set('search', v.trim());
            else p.delete('search');
          }),
        onClear: () =>
          setParam((p) => {
            p.set('section', 'staff_schedule');
            p.delete('search');
          }),
        placeholder: 'Search name or ID',
        variant: 'blue',
      }}
      filters={
        <AdminFilterChips
          options={STAFF_VIEW_OPTIONS}
          value={
            staffView === 'technician' || staffView === 'packer'
              ? 'all'
              : staffView
          }
          onChange={setStaffView}
        />
      }
      stats={
        <AdminFilterChips
          options={ROLE_OPTIONS}
          value={staffView === 'technician' || staffView === 'packer' ? staffView : 'all'}
          onChange={setStaffView}
        />
      }
    >
      {isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-text-faint">Loading staff…</div>
      ) : filtered.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-text-faint">No matches.</div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((row) => (
            <li key={row.id}>
              <AdminPickerRow
                selected={selectedStaffId === row.id}
                onPick={() =>
                  setParam((p) => {
                    p.set('section', 'staff_schedule');
                    p.set('staffId', String(row.id));
                  })
                }
                leading={
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-caption font-bold text-white"
                    style={{ backgroundColor: getStaffColorHex(row) }}
                  >
                    {initials(row.name)}
                  </div>
                }
                title={row.name}
                subtitle={row.role.replace(/_/g, ' ')}
                trailing={
                  <HoverTooltip label={row.active ? 'Active' : 'Inactive'} asChild focusable={false}>
                    <span
                      className={`h-2 w-2 rounded-full ${row.active ? 'bg-emerald-500' : 'bg-border-emphasis'}`}
                    />
                  </HoverTooltip>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
