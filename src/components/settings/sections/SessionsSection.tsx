'use client';

/**
 * /settings?section=sessions — admin view of active staff sessions with
 * one-click revoke.
 */

import { useCallback, useEffect, useState } from 'react';

interface SessionRow {
  sid: string;
  staff_id: number;
  staff_name: string;
  device_kind: string;
  device_label: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

function fmtRelative(when: string): string {
  const ms = Date.now() - new Date(when).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SessionsSection() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/sessions', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setErr(r.status === 401 || r.status === 403 ? "You don't have access to this." : 'Could not load sessions.');
        return;
      }
      const data = await r.json() as { sessions: SessionRow[] };
      setRows(data.sessions || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = useCallback(async (sid: string) => {
    if (!confirm('Revoke this session?')) return;
    await fetch(`/api/admin/sessions/${encodeURIComponent(sid)}`, {
      method: 'DELETE', credentials: 'include',
    });
    await refresh();
  }, [refresh]);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Active sessions</h1>
        <p className="text-sm text-gray-500">Anyone signed in right now. Revoke to kick a device.</p>
      </header>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Last activity</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.sid}>
                <td className="px-3 py-2 font-medium text-gray-900">{row.staff_name}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 mr-2">{row.device_kind}</span>
                  {row.device_label && <span className="text-gray-500">{row.device_label}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{row.ip || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{fmtRelative(row.last_seen_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => void revoke(row.sid)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No active sessions.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
