'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';

type UnifiedLogRow = {
  event_id: string;
  kind: 'AUDIT' | 'SAL';
  created_at: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  station: string | null;
  action: string;
  source: string | null;
  entity_type: string | null;
  entity_id: string | null;
  station_activity_log_id: number | null;
  notes: string | null;
  scan_ref: string | null;
  fnsku: string | null;
  detail_value: string | null;
  detail_route: string | null;
  metadata: Record<string, unknown> | null;
};

interface AdminLogsTabProps {
  initialSearch?: string;
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export function AdminLogsTab({ initialSearch = '' }: AdminLogsTabProps) {
  const [search, setSearch] = useState(initialSearch);
  const [kind, setKind] = useState<'all' | 'audit' | 'sal'>('all');
  const [actorStaffIdInput, setActorStaffIdInput] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const actorStaffId = useMemo(() => {
    const n = Number(actorStaffIdInput);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [actorStaffIdInput]);

  const query = useQuery({
    queryKey: ['admin-logs', { search, kind, actorStaffId, offset, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (search.trim()) params.set('q', search.trim());
      if (kind !== 'all') params.set('kind', kind);
      if (actorStaffId != null) params.set('actorStaffId', String(actorStaffId));
      const res = await fetch(`/api/admin/logs?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load admin logs');
      return {
        rows: (Array.isArray(data?.rows) ? data.rows : []) as UnifiedLogRow[],
        hasMore: Boolean(data?.pagination?.hasMore),
      };
    },
  });

  const rows = query.data?.rows ?? [];
  const hasMore = query.data?.hasMore ?? false;

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-6`}>
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-900">Logs</p>
            <span className="text-[11px] text-gray-500">{rows.length} rows loaded</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => {
                setOffset(0);
                setSearch(e.target.value);
              }}
              placeholder="Search action/source/entity/notes"
              className="h-8 w-[280px] border border-gray-300 px-2 text-xs"
            />
            <select
              value={kind}
              onChange={(e) => {
                setOffset(0);
                setKind(e.target.value as 'all' | 'audit' | 'sal');
              }}
              className="h-8 border border-gray-300 px-2 text-xs"
            >
              <option value="all">All</option>
              <option value="audit">Audit</option>
              <option value="sal">SAL</option>
            </select>
            <input
              value={actorStaffIdInput}
              onChange={(e) => {
                setOffset(0);
                setActorStaffIdInput(e.target.value);
              }}
              placeholder="Actor staff id"
              className="h-8 w-[120px] border border-gray-300 px-2 text-xs"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border border-gray-200">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1200px]">
              <div className="grid grid-cols-[96px_176px_160px_108px_160px_180px_160px_1fr] gap-x-3 border-b border-gray-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                <p>Kind</p>
                <p>Created</p>
                <p>Actor</p>
                <p>Station</p>
                <p>Action</p>
                <p>Entity</p>
                <p>Source</p>
                <p>Details</p>
              </div>

              {query.isLoading ? (
                <div className="px-4 py-6 text-xs text-gray-500">Loading logs...</div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-6 text-xs text-gray-500">No logs found.</div>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.event_id}
                    className="grid grid-cols-[96px_176px_160px_108px_160px_180px_160px_1fr] gap-x-3 border-b border-gray-100 px-4 py-3 text-[11px] text-gray-700"
                  >
                    <p className="font-semibold">{row.kind}</p>
                    <p>{formatDateTime(row.created_at)}</p>
                    <p className="truncate">
                      {row.actor_name?.trim()
                        ? `${row.actor_name} (#${row.actor_staff_id ?? '-'})`
                        : row.actor_staff_id != null
                          ? `#${row.actor_staff_id}`
                          : 'System'}
                    </p>
                    <p>{row.station ?? '-'}</p>
                    <p className="font-medium">{row.action}</p>
                    <p>{row.entity_type ? `${row.entity_type}:${row.entity_id ?? ''}` : '-'}</p>
                    <p className="truncate">{row.source || '-'}</p>
                    <p className="truncate text-gray-500">
                      {row.detail_value || row.notes || row.scan_ref || row.fnsku || '-'}
                      {row.detail_route ? (
                        <>
                          {' '}
                          <a href={row.detail_route} className="text-blue-600 hover:underline">
                            open
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2">
            <button
              type="button"
              onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
              disabled={offset <= 0}
              className="h-8 border border-gray-300 px-3 text-xs disabled:opacity-50"
            >
              Previous
            </button>
            <p className="text-xs text-gray-500">
              Offset {offset}
            </p>
            <button
              type="button"
              onClick={() => setOffset((prev) => prev + limit)}
              disabled={!hasMore}
              className="h-8 border border-gray-300 px-3 text-xs disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
