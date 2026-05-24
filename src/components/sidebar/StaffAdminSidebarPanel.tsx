'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  AdminSidebarShell,
  AdminFilterChips,
  AdminPickerRow,
  useAdminUrlState,
} from '@/components/admin/shared';
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

function emitOpenAddStaff() {
  window.dispatchEvent(new CustomEvent('admin-staff-open-add'));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function StaffAdminSidebarPanel() {
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
    queryKey: ['staff'],
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
      if (next === 'all') p.delete('staffView');
      else p.set('staffView', next);
    });
  };

  // Two chip groups stack vertically; the second goes in `stats` slot so the
  // separators read cleanly.
  return (
    <AdminSidebarShell
      search={
        <SearchBar
          value={search}
          onChange={(v) =>
            setParam((p) => {
              if (v.trim()) p.set('search', v.trim());
              else p.delete('search');
            })
          }
          onClear={() => setParam((p) => p.delete('search'))}
          placeholder="Search name or ID"
          variant="blue"
          className="w-full"
        />
      }
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
      action={
        <button
          type="button"
          onClick={emitOpenAddStaff}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-1.5 text-label font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          Add staff
        </button>
      }
    >
      {isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading staff…</div>
      ) : filtered.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">No matches.</div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((row) => (
            <li key={row.id}>
              <AdminPickerRow
                selected={selectedStaffId === row.id}
                onPick={() => setParam((p) => p.set('staffId', String(row.id)))}
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
                  <span
                    title={row.active ? 'Active' : 'Inactive'}
                    className={`h-2 w-2 rounded-full ${row.active ? 'bg-emerald-500' : 'bg-gray-400'}`}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
