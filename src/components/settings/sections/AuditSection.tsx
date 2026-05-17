'use client';

/**
 * /settings?section=audit — auth audit log tail.
 */

import { useEffect, useState } from 'react';

interface AuditRow {
  id: number;
  staff_id: number | null;
  staff_name: string | null;
  event: string;
  result: string;
  ip: string | null;
  sid: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

const RESULT_CLASS: Record<string, string> = {
  ok:     'bg-green-100 text-green-800',
  denied: 'bg-amber-100 text-amber-900',
  error:  'bg-red-100 text-red-800',
};

export function AuditSection() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/admin/audit?limit=200', { credentials: 'include', cache: 'no-store' });
        if (!r.ok) {
          setErr(r.status === 401 || r.status === 403 ? "You don't have access to this." : 'Could not load audit log.');
          return;
        }
        const data = await r.json() as { entries: AuditRow[] };
        setRows(data.entries || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (err) return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>;

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Audit log</h1>
        <p className="text-sm text-gray-500">Latest 200 auth events: sign-ins, denials, role changes, enrollments.</p>
      </header>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.staff_name ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-xs font-mono">{row.event}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${RESULT_CLASS[row.result] || 'bg-gray-100 text-gray-700'}`}>
                    {row.result}
                  </span>
                </td>
                <td className="px-3 py-2 text-[11px] font-mono text-gray-500 max-w-[400px] truncate">
                  {Object.keys(row.detail || {}).length > 0 ? JSON.stringify(row.detail) : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No audit entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
