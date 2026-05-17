'use client';

/**
 * Sidebar for /admin?section=roles — vertical role list with drag-to-reorder
 * priority and a "+ Create role" button at the top.
 *
 * Selection drives `?roleId=<id>` in the URL. Listens for `admin-roles-refresh`
 * to refetch after a mutation in the main area.
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
import { CreateRoleDialog } from './roles/CreateRoleDialog';

interface RoleRow {
  id: number;
  key: string;
  label: string;
  color: string;
  position: number;
  is_system: boolean;
  member_count: number;
}

export function RolesSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRaw = searchParams.get('roleId');
  const selectedRoleId = (() => {
    if (!selectedRaw) return null;
    const n = Number(selectedRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch('/api/admin/roles', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setErr(r.status === 401 || r.status === 403 ? "You don't have admin access." : 'Could not load roles.');
        return;
      }
      const data = await r.json() as { roles: RoleRow[] };
      setRows(data.roles || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener('admin-roles-refresh', handler);
    return () => window.removeEventListener('admin-roles-refresh', handler);
  }, [refresh]);

  const selectRole = useCallback((id: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('roleId', String(id));
    router.replace(`/admin?${params.toString()}`);
  }, [router, searchParams]);

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
    setRows(next);
    void fetch('/api/admin/roles/reorder', {
      method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: next.map((r) => r.id) }),
    });
  }, [rows]);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="flex-shrink-0 border-b border-gray-200 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Create role
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400">Loading roles…</div>
        ) : err ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
        ) : rows.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400">No roles yet.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <SortableRoleRow key={r.id} role={r} selected={selectedRoleId === r.id} onPick={selectRole} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <CreateRoleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(newId) => {
          void refresh();
          selectRole(newId);
        }}
      />
    </div>
  );
}

interface SortableRoleRowProps {
  role: RoleRow;
  selected: boolean;
  onPick: (id: number) => void;
}

function SortableRoleRow({ role, selected, onPick }: SortableRoleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: role.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <div className={`group flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 transition-all ${
        selected
          ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-500/30 shadow-sm shadow-blue-200/40'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}>
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="flex-shrink-0 cursor-grab text-gray-300 transition hover:text-gray-500 active:cursor-grabbing"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="9"  cy="6"  r="1.5"/>
            <circle cx="15" cy="6"  r="1.5"/>
            <circle cx="9"  cy="12" r="1.5"/>
            <circle cx="15" cy="12" r="1.5"/>
            <circle cx="9"  cy="18" r="1.5"/>
            <circle cx="15" cy="18" r="1.5"/>
          </svg>
        </button>

        {/* Color swatch */}
        <span className="h-6 w-6 flex-shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: role.color }} aria-hidden />

        <button
          type="button"
          onClick={() => onPick(role.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-gray-900">{role.label}</span>
            {role.is_system && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-gray-500">
                System
              </span>
            )}
          </div>
          <div className="truncate text-[10px] font-medium uppercase tracking-wider text-gray-500">
            {role.key}
          </div>
        </button>

        <span title={`${role.member_count} member${role.member_count === 1 ? '' : 's'}`} className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gray-600">
          {role.member_count}
        </span>
      </div>
    </li>
  );
}
