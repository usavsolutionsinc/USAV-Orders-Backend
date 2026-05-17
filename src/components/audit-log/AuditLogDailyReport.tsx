'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Section = 'receiving' | 'packing' | 'tech' | 'sku' | 'staff';

interface ReportPayload {
  totals: { events: number; distinct_items: number; distinct_staff: number };
  by_hour: Array<{ hour: number; count: number }>;
  by_action: Array<{ action: string; count: number }>;
  by_staff: Array<{ staff_id: number; name: string | null; count: number }>;
  by_item: Array<{ key: string; label: string; count: number }>;
}

const ITEM_PARAM_FOR_SECTION: Record<Section, string | null> = {
  receiving: 'po',
  packing: 'tracking',
  tech: 'session',
  sku: 'sku',
  staff: null,
};

const SECTION_HREF: Record<Section, string> = {
  receiving: '/audit-log/receiving',
  packing: '/audit-log/packing',
  tech: '/audit-log/tech',
  sku: '/audit-log/sku',
  staff: '/audit-log/staff',
};

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function actionLabel(action: string): string {
  return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function rangeLabel(searchParams: URLSearchParams): string {
  const day = searchParams.get('day');
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  if (day) {
    const today = new Date();
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (day === ymd(today)) return 'Today';
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    if (day === ymd(yest)) return 'Yesterday';
    return new Date(`${day}T00:00:00`).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    const sStr = s.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const eStr = e.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return sStr === eStr ? sStr : `${sStr} – ${eStr}`;
  }
  return 'All time';
}

export function AuditLogDailyReport({ section }: { section: Section }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() || SECTION_HREF[section];
  const sharedQS = useMemo(() => {
    const next = new URLSearchParams();
    for (const k of ['day', 'start', 'end', 'staffId', 'sku']) {
      const v = searchParams.get(k);
      if (v) next.set(k, v);
    }
    return next.toString();
  }, [searchParams]);

  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL('/api/audit-log/report', window.location.origin);
    url.searchParams.set('section', section);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setData(d as ReportPayload);
        else setError(d?.error ?? 'Failed to load report');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [section, sharedQS]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value == null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (loading) {
    return <CenterMessage label="Loading report…" />;
  }
  if (error) {
    return <CenterMessage label={error} tone="error" />;
  }
  if (!data) {
    return <CenterMessage label="No data." />;
  }

  const peakHourCount = Math.max(1, ...data.by_hour.map((h) => h.count));
  const peakActionCount = Math.max(1, ...data.by_action.map((a) => a.count));
  const peakStaffCount = Math.max(1, ...data.by_staff.map((s) => s.count));
  const peakItemCount = Math.max(1, ...data.by_item.map((i) => i.count));

  const itemParam = ITEM_PARAM_FOR_SECTION[section];

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          {section} audit · daily report
        </p>
        <h2 className="mt-0.5 text-base font-bold text-gray-900">
          {rangeLabel(new URLSearchParams(searchParams.toString()))}
        </h2>
        <div className="mt-2 flex flex-wrap gap-3">
          <TotalsBadge label="Events" value={data.totals.events} tone="emerald" />
          <TotalsBadge
            label={section === 'sku' ? 'Distinct SKUs' : section === 'staff' ? 'Distinct staff' : 'Distinct items'}
            value={data.totals.distinct_items}
            tone="sky"
          />
          <TotalsBadge label="Distinct staff" value={data.totals.distinct_staff} tone="violet" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
          {/* Hourly distribution */}
          <Card title="Hourly distribution">
            <div className="flex h-24 items-end gap-[2px]">
              {data.by_hour.map((h) => (
                <div
                  key={h.hour}
                  className="flex-1 rounded-sm bg-emerald-500/80"
                  style={{ height: `${Math.max(2, (h.count / peakHourCount) * 100)}%` }}
                  title={`${h.hour}:00 — ${fmtNumber(h.count)}`}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] tabular-nums text-gray-400">
              <span>0:00</span>
              <span>6:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>23:00</span>
            </div>
          </Card>

          {/* Top actions */}
          <Card title="Top actions">
            {data.by_action.length === 0 ? (
              <p className="text-[11px] text-gray-400">No events.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.by_action.slice(0, 8).map((a) => (
                  <li key={a.action} className="flex items-center gap-2 text-[11px]">
                    <span className="w-32 shrink-0 truncate font-semibold text-gray-800">
                      {actionLabel(a.action)}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full bg-sky-500"
                        style={{ width: `${(a.count / peakActionCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right tabular-nums text-gray-500">
                      {fmtNumber(a.count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Top staff */}
          <Card title="Top staff">
            {data.by_staff.length === 0 ? (
              <p className="text-[11px] text-gray-400">No events.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.by_staff.map((s) => (
                  <li key={s.staff_id}>
                    <button
                      type="button"
                      onClick={() => setParam('staffId', String(s.staff_id))}
                      className="flex w-full items-center gap-2 text-left text-[11px] hover:opacity-80"
                    >
                      <span className="w-32 shrink-0 truncate font-semibold text-gray-800">
                        {s.name ?? `#${s.staff_id}`}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full bg-violet-500"
                          style={{ width: `${(s.count / peakStaffCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right tabular-nums text-gray-500">
                        {fmtNumber(s.count)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Top items */}
          <Card title={`Top ${section === 'staff' ? 'staff' : 'items'}`}>
            {data.by_item.length === 0 ? (
              <p className="text-[11px] text-gray-400">No events.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.by_item.map((it) => {
                  const Element: 'button' | 'div' = itemParam ? 'button' : 'div';
                  return (
                    <li key={it.key}>
                      <Element
                        {...(itemParam
                          ? {
                              type: 'button' as const,
                              onClick: () => setParam(itemParam, it.key),
                            }
                          : {})}
                        className={`flex w-full items-center gap-2 text-left text-[11px] ${
                          itemParam ? 'hover:opacity-80' : ''
                        }`}
                      >
                        <span className="w-32 shrink-0 truncate font-mono font-semibold text-gray-800">
                          {it.label}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${(it.count / peakItemCount) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right tabular-nums text-gray-500">
                          {fmtNumber(it.count)}
                        </span>
                      </Element>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TotalsBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'sky' | 'violet';
}) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  }[tone];
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${toneClass}`}
    >
      <span className="text-[9px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="tabular-nums">{fmtNumber(value)}</span>
    </span>
  );
}

function CenterMessage({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p
        className={`text-center text-[12px] ${
          tone === 'error' ? 'text-rose-600' : 'text-gray-400'
        }`}
      >
        {label}
      </p>
    </div>
  );
}
