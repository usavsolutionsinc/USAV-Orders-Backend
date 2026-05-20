'use client';

import { useEffect, useState } from 'react';
import { FileText } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

interface AuditEntry {
  id: number;
  staff_id: number | null;
  staff_name: string | null;
  event: string;
  result: string | null;
  detail: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const delta = Date.now() - ms;
  const min = Math.round(delta / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function RecentAuditCard() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/audit?limit=5', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Audit ${r.status}`))))
      .then((d: { entries?: AuditEntry[] }) => setEntries(d.entries ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StatusCard
      icon={FileText}
      title="Recent activity"
      href="/admin?section=logs"
      linkLabel="View full log →"
      loading={loading}
      error={error}
      empty={entries && entries.length === 0 ? 'No recent admin activity.' : null}
      wide
    >
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
              <span className="w-16 flex-shrink-0 text-xs text-slate-500">{timeAgo(e.created_at)}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-slate-900">{e.event}</span>
                {e.staff_name && <span className="text-slate-500"> · {e.staff_name}</span>}
                {e.result && e.result !== 'ok' && (
                  <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">{e.result}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StatusCard>
  );
}
