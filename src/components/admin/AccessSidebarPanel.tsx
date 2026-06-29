'use client';

/**
 * Sidebar for /settings/access — the picker side of the access
 * workflow. Search + filter + stats + add-staff + a scrollable list of
 * staff rows whose selection drives `?staffId=` in the URL.
 *
 * Pure URL-state contract:
 *   ?search=<q>                       — search box value
 *   ?accessStatus=all|active|invited|disabled
 *   ?staffId=<id>                     — currently-selected staff (read by detail)
 *
 * Data fetched here (panel-owned, matches the other admin sidebar panels);
 * the detail view fetches its own envelope independently. We listen for
 * `admin-access-refresh` to refetch the list after a mutation in the detail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { StatPill } from './access/StatPill';
import { AddStaffDialog } from './access/AddStaffDialog';
import { Button, IconButton } from '@/design-system/primitives';

interface StaffRow {
  id: number;
  name: string;
  role: string;
  status: string;
  active: boolean;
  employee_id: string | null;
  employee_code: string | null;
  has_pin: boolean;
  passkey_count: number;
  last_login_at: string | null;
}

type StatusFilter = 'all' | 'active' | 'invited' | 'disabled';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function asStatusFilter(raw: string | null | undefined): StatusFilter {
  if (raw === 'active' || raw === 'invited' || raw === 'disabled') return raw;
  return 'all';
}

export function AccessSidebarPanel({ basePath = '/settings/access' }: { basePath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const statusFilter = asStatusFilter(searchParams.get('accessStatus'));
  const selectedStaffId = (() => {
    const raw = searchParams.get('staffId');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch('/api/admin/staff', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setErr(r.status === 401 || r.status === 403 ? "You don't have admin access." : 'Could not load staff.');
        return;
      }
      const data = await r.json() as { staff: StaffRow[] };
      setRows(data.staff || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Detail view mutations dispatch this event so the sidebar list updates
  // without us having to reach across components.
  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener('admin-access-refresh', handler);
    return () => window.removeEventListener('admin-access-refresh', handler);
  }, [refresh]);

  const setParam = useCallback((mutator: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    router.replace(`${basePath}?${params.toString()}`);
  }, [router, searchParams, basePath]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q) ||
        (r.employee_code ?? '').toLowerCase().includes(q) ||
        String(r.id) === q
      );
    });
  }, [rows, search, statusFilter]);

  // DnD is only meaningful on the full list. Drag-handles hide when the
  // user filters (otherwise a drop would imply a global reorder based on
  // partial information).
  const reorderEnabled = !search.trim() && statusFilter === 'all';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = rows.findIndex((r) => r.id === Number(active.id));
    const newIdx = rows.findIndex((r) => r.id === Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(rows, oldIdx, newIdx);
    setRows(next);  // optimistic — visible immediately
    void fetch('/api/admin/staff/reorder', {
      method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: next.map((r) => r.id) }),
    }).catch(() => { void refresh(); });
  }, [rows, refresh]);

  const sortableIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.status === 'active').length;
    const withPin = rows.filter((r) => r.has_pin).length;
    const withPasskey = rows.filter((r) => r.passkey_count > 0).length;
    return { total, active, withPin, withPasskey };
  }, [rows]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Search */}
      <div className="flex-shrink-0 border-b border-gray-200 px-3 py-3">
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setParam((p) => {
              const v = e.target.value;
              if (v) p.set('search', v); else p.delete('search');
            })}
            placeholder="Search name, code, or id…"
            className="h-9 w-full rounded-xl border border-gray-200 bg-white pl-8 pr-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
          />
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-gray-200 px-3 py-2">
        {(['all', 'active', 'invited', 'disabled'] as const).map((s) => (
          // ds-raw-button: two-state segmented filter toggle with custom active fill (blue-600)
          <button
            key={s}
            type="button"
            onClick={() => setParam((p) => {
              if (s === 'all') p.delete('accessStatus'); else p.set('accessStatus', s);
            })}
            className={`flex-1 rounded-lg px-2 py-1 text-micro font-bold uppercase tracking-wider transition ${
              statusFilter === s ? 'bg-blue-600 text-white shadow-sm shadow-blue-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Stats strip */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-200 px-3 py-2">
        <StatPill label="Total"   value={stats.total} />
        <StatPill label="Active"  value={stats.active}     tone="green" />
        <StatPill label="PIN"     value={stats.withPin}    tone="blue" />
        <StatPill label="Passkey" value={stats.withPasskey} tone="purple" />
      </div>

      {/* Add staff button */}
      <div className="flex-shrink-0 border-b border-gray-200 px-3 py-2.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAddOpen(true)}
          icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>}
          className="w-full border border-dashed border-gray-300 ring-0 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          Add staff
        </Button>
      </div>

      {/* Staff list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400">Loading staff…</div>
        ) : err ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400">No matches.</div>
        ) : reorderEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {filtered.map((row) => (
                  <SortableStaffSidebarRow
                    key={row.id}
                    row={row}
                    selected={selectedStaffId === row.id}
                    onPick={() => setParam((p) => p.set('staffId', String(row.id)))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((row) => (
              <StaffSidebarRow
                key={row.id}
                row={row}
                selected={selectedStaffId === row.id}
                onPick={() => setParam((p) => p.set('staffId', String(row.id)))}
              />
            ))}
          </ul>
        )}
      </div>

      <AddStaffDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(newId) => {
          // Refresh list + jump straight into the new staff's detail.
          void refresh();
          setParam((p) => p.set('staffId', String(newId)));
        }}
      />
    </div>
  );
}

interface StaffSidebarRowProps {
  row: StaffRow;
  selected: boolean;
  onPick: () => void;
}

const STATUS_DOT: Record<string, string> = {
  active:    'bg-green-500',
  invited:   'bg-amber-500',
  suspended: 'bg-orange-500',
  disabled:  'bg-gray-400',
};

function StaffSidebarRow({ row, selected, onPick }: StaffSidebarRowProps) {
  const theme = getStaffThemeById(row.id);
  const sc = stationThemeColors[theme];
  const isAdmin = row.role === 'admin';

  return (
    <li>
      {/* ds-raw-button: text-left multi-line master-detail picker row (avatar + name + meta + status dot) */}
      <button
        type="button"
        onClick={onPick}
        aria-current={selected ? 'true' : undefined}
        className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all ${
          selected
            ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-500/30 shadow-sm shadow-blue-200/40'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
        }`}
      >
        <div className="relative flex-shrink-0">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${sc.bg} text-caption font-bold text-white`}>
            {initials(row.name)}
          </div>
          {isAdmin && (
            <HoverTooltip label="Admin · All Access" asChild focusable={false}>
              <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 ring-2 ring-white">
                <svg className="h-2 w-2 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </span>
            </HoverTooltip>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">{row.name}</span>
            <span className="text-eyebrow text-gray-400">#{row.id}</span>
          </div>
          <div className="truncate text-micro font-medium uppercase tracking-wider text-gray-500">
            {row.role.replace(/_/g, ' ')}
          </div>
        </div>
        <HoverTooltip label={row.status} asChild focusable={false}>
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[row.status] || STATUS_DOT.active}`} aria-label={`Status: ${row.status}`} />
        </HoverTooltip>
      </button>
    </li>
  );
}

/**
 * Same as StaffSidebarRow but with a drag handle on the left for reorder.
 * Used only when the list isn't filtered (`reorderEnabled` in the parent).
 */
function SortableStaffSidebarRow({ row, selected, onPick }: StaffSidebarRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const theme = getStaffThemeById(row.id);
  const sc = stationThemeColors[theme];
  const isAdmin = row.role === 'admin';

  return (
    <li ref={setNodeRef} style={style}>
      <div className={`group flex w-full items-center gap-2 rounded-xl border px-2 py-2 transition-all ${
        selected
          ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-500/30 shadow-sm shadow-blue-200/40'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}>
        <IconButton
          {...attributes}
          {...listeners}
          icon={
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="9"  cy="6"  r="1.5"/><circle cx="15" cy="6"  r="1.5"/>
              <circle cx="9"  cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9"  cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
            </svg>
          }
          ariaLabel="Drag to reorder"
          className="flex-shrink-0 cursor-grab text-gray-300 hover:text-gray-500 active:cursor-grabbing"
        />
        {/* ds-raw-button: text-left multi-line master-detail picker row (avatar + name + meta + status dot) */}
        <button
          type="button"
          onClick={onPick}
          aria-current={selected ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <div className="relative flex-shrink-0">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${sc.bg} text-caption font-bold text-white`}>
              {initials(row.name)}
            </div>
            {isAdmin && (
              <HoverTooltip label="Admin · All Access" asChild focusable={false}>
                <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 ring-2 ring-white">
                  <svg className="h-2 w-2 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                </span>
              </HoverTooltip>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-gray-900">{row.name}</span>
              <span className="text-eyebrow text-gray-400">#{row.id}</span>
            </div>
            <div className="truncate text-micro font-medium uppercase tracking-wider text-gray-500">
              {row.role.replace(/_/g, ' ')}
            </div>
          </div>
          <HoverTooltip label={row.status} asChild focusable={false}>
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[row.status] || STATUS_DOT.active}`} aria-label={`Status: ${row.status}`} />
          </HoverTooltip>
        </button>
      </div>
    </li>
  );
}
