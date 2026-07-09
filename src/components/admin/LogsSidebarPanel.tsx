'use client';

/**
 * Sidebar for /admin?section=logs — picker for the unified audit + SAL log feed.
 *
 * URL-state contract:
 *   ?search=<q>                  — text search (action/source/entity/notes)
 *   ?logKind=audit|sal           — filter chip (default: all)
 *   ?actorStaffId=<id>           — actor filter
 *   ?eventId=<id>                — selected event (read by main pane)
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AdminSidebarShell,
  AdminFilterChips,
  AdminPickerRow,
  useAdminUrlState,
} from './shared';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';

type LogKind = 'all' | 'audit' | 'sal';

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

const KIND_OPTIONS = [
  { value: 'all' as LogKind, label: 'All' },
  { value: 'audit' as LogKind, label: 'Audit' },
  { value: 'sal' as LogKind, label: 'SAL' },
];

function asKind(raw: string | null): LogKind {
  if (raw === 'audit' || raw === 'sal') return raw;
  return 'all';
}

function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateLabel(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function dayKey(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const KIND_DOT: Record<string, string> = {
  AUDIT: 'bg-blue-500',
  SAL: 'bg-purple-500',
};

const PAGE_LIMIT = 100;

export function LogsSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const kind = asKind(searchParams.get('logKind'));
  const actorRaw = searchParams.get('actorStaffId');
  const actorStaffId = (() => {
    if (!actorRaw) return null;
    const n = Number(actorRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const selected = searchParams.get('eventId') ?? '';

  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['admin-logs', { search, kind, actorStaffId, offset }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
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

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; rows: UnifiedLogRow[] }>();
    for (const r of rows) {
      const key = dayKey(r.created_at);
      const existing = map.get(key);
      if (existing) existing.rows.push(r);
      else map.set(key, { label: formatDateLabel(r.created_at), rows: [r] });
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, ...value }));
  }, [rows]);

  return (
    <AdminSidebarShell
      search={{
        value: search,
        onChange: (v) => {
          setOffset(0);
          setParam((p) => {
            p.set('section', 'logs');
            if (v.trim()) p.set('search', v.trim());
            else p.delete('search');
          });
        },
        onClear: () => {
          setOffset(0);
          setParam((p) => {
            p.set('section', 'logs');
            p.delete('search');
          });
        },
        placeholder: 'Search action, source, entity',
        variant: 'blue',
      }}
      filters={
        <AdminFilterChips
          options={KIND_OPTIONS}
          value={kind}
          onChange={(next) => {
            setOffset(0);
            setParam((p) => {
              p.set('section', 'logs');
              if (next === 'all') p.delete('logKind');
              else p.set('logKind', next);
            });
          }}
        />
      }
      action={
        <input
          type="text"
          inputMode="numeric"
          value={actorRaw ?? ''}
          onChange={(e) => {
            setOffset(0);
            setParam((p) => {
              p.set('section', 'logs');
              if (e.target.value.trim()) p.set('actorStaffId', e.target.value.trim());
              else p.delete('actorStaffId');
            });
          }}
          placeholder="Filter by actor staff id"
          className="h-9 w-full rounded-lg border border-border-soft bg-surface-card px-3 text-label text-text-default outline-none transition placeholder:text-text-faint focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
        />
      }
    >
      {query.isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-text-faint">Loading logs…</div>
      ) : rows.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-text-faint">No logs.</div>
      ) : (
        <>
          {grouped.map((group) => (
            <div key={group.key} className="mb-2">
              <p className="px-1 pb-1.5 pt-2 text-eyebrow font-black uppercase tracking-widest text-text-faint">
                {group.label}
              </p>
              <ul className="space-y-1.5">
                {group.rows.map((row) => {
                  const actor =
                    row.actor_name?.trim()
                      ? row.actor_name
                      : row.actor_staff_id != null
                        ? `#${row.actor_staff_id}`
                        : 'System';
                  return (
                    <li key={row.event_id}>
                      <AdminPickerRow
                        selected={selected === row.event_id}
                        onPick={() => setParam((p) => { p.set('section', 'logs'); p.set('eventId', row.event_id); })}
                        title={row.action}
                        subtitle={`${formatTime(row.created_at)} · ${actor}`}
                        trailing={
                          <HoverTooltip label={row.kind} asChild focusable={false}>
                            <span
                              className={`h-2 w-2 rounded-full ${KIND_DOT[row.kind] ?? 'bg-border-emphasis'}`}
                            />
                          </HoverTooltip>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 border-t border-border-soft pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_LIMIT))}
              disabled={offset <= 0}
            >
              Prev
            </Button>
            <span className="text-micro text-text-soft">offset {offset}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOffset((prev) => prev + PAGE_LIMIT)}
              disabled={!hasMore}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </AdminSidebarShell>
  );
}
