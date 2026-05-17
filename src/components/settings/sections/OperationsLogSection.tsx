'use client';

/**
 * /settings?section=operations-log — unified operational log viewer.
 *
 * Consumes /api/admin/logs which unions audit_logs (field-level diffs from
 * createAuditLog/recordAudit callers) with station_activity_logs (cross-
 * station SAL ledger). Filters on actor, action, entity type, station, and
 * date range; all params are server-side.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface UnifiedLogRow {
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
}

interface Pagination { limit: number; offset: number; hasMore: boolean }

const KIND_BADGE: Record<string, string> = {
  AUDIT: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  SAL:   'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
};

const PAGE_SIZE = 100;

export function OperationsLogSection() {
  const [rows, setRows] = useState<UnifiedLogRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'audit' | 'sal'>('all');
  const [actorStaffId, setActorStaffId] = useState<string>('');
  const [entityType, setEntityType] = useState<string>('');
  const [station, setStation] = useState<string>('');
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String(pagination.offset));
    if (q.trim()) p.set('q', q.trim());
    if (kind !== 'all') p.set('kind', kind);
    if (actorStaffId.trim()) p.set('actorStaffId', actorStaffId.trim());
    if (entityType.trim()) p.set('entityType', entityType.trim());
    if (station.trim()) p.set('station', station.trim());
    if (start) p.set('start', start);
    if (end) p.set('end', end);
    return p.toString();
  }, [pagination.offset, q, kind, actorStaffId, entityType, station, start, end]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/logs?${queryString}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!r.ok) {
        setErr(r.status === 401 || r.status === 403 ? "You don't have access to this." : 'Could not load logs.');
        setRows([]);
        return;
      }
      const data = (await r.json()) as { rows?: UnifiedLogRow[]; pagination?: Pagination };
      setRows(data.rows ?? []);
      if (data.pagination) setPagination(data.pagination);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load logs');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { void load(); }, [load]);

  // Reset offset when filters change.
  const resetAndApply = useCallback((apply: () => void) => {
    apply();
    setPagination((p) => ({ ...p, offset: 0 }));
  }, []);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Operations log</h1>
        <p className="text-sm text-gray-500">
          Every bin, SKU, and receiving mutation, attributed to the signed-in staff.
        </p>
      </header>

      {/* Filter bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input
            type="search"
            value={q}
            onChange={(e) => resetAndApply(() => setQ(e.target.value))}
            placeholder="Search action, staff, entity…"
            className="col-span-2 rounded-md border border-gray-200 px-2 py-1.5 text-sm sm:col-span-2"
          />
          <select
            value={kind}
            onChange={(e) => resetAndApply(() => setKind(e.target.value as typeof kind))}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm"
          >
            <option value="all">All sources</option>
            <option value="audit">Audit only</option>
            <option value="sal">Station activity only</option>
          </select>
          <input
            type="number"
            value={actorStaffId}
            onChange={(e) => resetAndApply(() => setActorStaffId(e.target.value))}
            placeholder="Staff ID"
            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            value={entityType}
            onChange={(e) => resetAndApply(() => setEntityType(e.target.value))}
            placeholder="Entity type (bin, sku_stock…)"
            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            value={station}
            onChange={(e) => resetAndApply(() => setStation(e.target.value))}
            placeholder="Station"
            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={start}
            onChange={(e) => resetAndApply(() => setStart(e.target.value))}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={end}
            onChange={(e) => resetAndApply(() => setEnd(e.target.value))}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Results */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {err && !loading && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-red-600">{err}</td></tr>
            )}
            {!loading && !err && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No entries.</td></tr>
            )}
            {!loading && !err && rows.map((row) => (
              <tr key={row.event_id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${KIND_BADGE[row.kind] ?? 'bg-gray-100 text-gray-700'}`}>
                    {row.kind}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="font-semibold text-gray-900">
                    {row.actor_name ?? <span className="text-gray-400">—</span>}
                  </div>
                  {row.actor_role && (
                    <div className="text-[10px] text-gray-400">{row.actor_role}</div>
                  )}
                  {row.station && (
                    <div className="text-[10px] font-mono text-gray-400">@ {row.station}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-gray-800">{row.action}</td>
                <td className="px-3 py-2 text-xs">
                  {row.entity_type && (
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">
                      {row.entity_type}
                    </div>
                  )}
                  {row.entity_id && (
                    <div className="font-mono text-gray-700">{row.entity_id}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-gray-500 max-w-[300px]">
                  {row.detail_value && (
                    <div className="font-mono truncate" title={row.detail_value}>
                      {row.detail_value}
                    </div>
                  )}
                  {row.scan_ref && (
                    <div className="text-[10px] text-gray-400 font-mono">scan: {row.scan_ref}</div>
                  )}
                  {row.metadata && typeof row.metadata === 'object' && Object.keys(row.metadata).length > 0 && (
                    <div className="text-[10px] text-gray-400 font-mono truncate" title={JSON.stringify(row.metadata)}>
                      {JSON.stringify(row.metadata)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Rows {pagination.offset + 1}–{pagination.offset + rows.length}
          {pagination.hasMore ? ' (more available)' : ''}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pagination.offset === 0 || loading}
            onClick={() =>
              setPagination((p) => ({ ...p, offset: Math.max(0, p.offset - PAGE_SIZE) }))
            }
            className="rounded-md border border-gray-200 bg-white px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!pagination.hasMore || loading}
            onClick={() => setPagination((p) => ({ ...p, offset: p.offset + PAGE_SIZE }))}
            className="rounded-md border border-gray-200 bg-white px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
