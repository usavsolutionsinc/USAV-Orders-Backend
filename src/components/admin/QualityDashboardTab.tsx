'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Wrench, ShieldCheck } from '@/components/Icons';
import { qualitySeverityToneClass } from '@/lib/quality-severity-tone';

/**
 * Admin → Quality: risk distribution, top open failure modes, repair rollup,
 * and the highest-risk units worklist. Read-only aggregates from
 * GET /api/quality/dashboard.
 */

interface DashboardResp {
  ok: boolean;
  risk: { low: number; medium: number; high: number; total: number; avg_score: number | null };
  top_failures: { id: number; code: string; label: string; severity: string; open_count: number }[];
  repairs: { by_status: Record<string, number>; total_cost_cents: number };
  high_risk_units: {
    serial_unit_id: number;
    serial_number: string;
    sku: string | null;
    unit_uid: string | null;
    quality_score: number;
    risk_level: string;
    risk_reasons: string[];
    grade: string | null;
  }[];
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function QualityDashboardTab() {
  const { data, isLoading, isError, error } = useQuery<DashboardResp>({
    queryKey: ['quality.dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/quality/dashboard', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json as DashboardResp;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-caption text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading quality analytics…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-8 text-caption text-rose-600">
        {error instanceof Error ? error.message : 'Failed to load quality analytics'}
      </div>
    );
  }

  const completedRepairs = data.repairs.by_status.completed ?? 0;
  const openRepairs = (data.repairs.by_status.pending ?? 0) + (data.repairs.by_status.in_progress ?? 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
      <header>
        <h1 className="text-xl font-black tracking-tight text-gray-900">Quality &amp; Risk</h1>
        <p className="mt-0.5 text-caption text-gray-500">
          Graded units, open failures, and repair throughput across inventory.
        </p>
      </header>

      {/* Risk tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Avg score" value={data.risk.avg_score ?? '—'} accent="text-gray-900" icon={<ShieldCheck className="h-4 w-4 text-gray-400" />} />
        <Tile label="Low risk" value={data.risk.low} accent="text-emerald-600" />
        <Tile label="Medium risk" value={data.risk.medium} accent="text-amber-600" />
        <Tile label="High risk" value={data.risk.high} accent="text-rose-600" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Top failures */}
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
          <header className="flex items-center gap-2 px-5 py-4">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">Top open failures</h3>
          </header>
          {data.top_failures.length === 0 ? (
            <p className="border-t border-gray-100 px-5 py-3 text-caption text-gray-400">No open failures. 🎉</p>
          ) : (
            <ul className="border-t border-gray-100 divide-y divide-gray-100">
              {data.top_failures.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-label font-bold text-gray-800">{f.label}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-micro font-bold uppercase ${qualitySeverityToneClass(f.severity)}`}>
                    {f.severity}
                  </span>
                  <span className="w-8 text-right text-label font-black tabular-nums text-gray-900">{f.open_count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Repair rollup */}
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
          <header className="flex items-center gap-2 px-5 py-4">
            <Wrench className="h-4 w-4 text-blue-500" />
            <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">Repairs</h3>
          </header>
          <div className="grid grid-cols-3 gap-px border-t border-gray-100 bg-gray-100">
            <MiniStat label="Open" value={openRepairs} />
            <MiniStat label="Completed" value={completedRepairs} />
            <MiniStat label="Total cost" value={dollars(data.repairs.total_cost_cents)} />
          </div>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {Object.entries(data.repairs.by_status).length === 0 ? (
              <li className="px-5 py-3 text-caption text-gray-400">No repairs logged.</li>
            ) : (
              Object.entries(data.repairs.by_status).map(([status, n]) => (
                <li key={status} className="flex items-center justify-between px-5 py-2 text-caption">
                  <span className="font-medium capitalize text-gray-600">{status.replace(/_/g, ' ')}</span>
                  <span className="font-black tabular-nums text-gray-900">{n}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      {/* High-risk worklist */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
        <header className="px-5 py-4">
          <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">Highest-risk units</h3>
        </header>
        {data.high_risk_units.length === 0 ? (
          <p className="border-t border-gray-100 px-5 py-3 text-caption text-gray-400">No high-risk units.</p>
        ) : (
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {data.high_risk_units.map((u) => (
              <li key={u.serial_unit_id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-10 text-right text-label font-black tabular-nums text-rose-600">{u.quality_score}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-label font-bold text-gray-900">
                    {u.unit_uid || u.serial_number}
                    {u.sku ? <span className="ml-2 font-mono text-micro font-medium text-gray-400">{u.sku}</span> : null}
                  </div>
                  {u.risk_reasons.length > 0 && (
                    <div className="mt-0.5 truncate text-micro text-gray-500">
                      {u.risk_reasons.map((r) => r.replace(/_/g, ' ')).join(' · ')}
                    </div>
                  )}
                </div>
                {u.grade ? (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-micro font-bold text-gray-600">{u.grade}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, accent, icon }: { label: string; value: number | string; accent: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="flex items-center justify-between">
        <span className="text-micro font-bold uppercase tracking-wider text-gray-400">{label}</span>
        {icon}
      </div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white px-4 py-3 text-center">
      <div className="text-lg font-black tabular-nums text-gray-900">{value}</div>
      <div className="text-micro font-bold uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}
