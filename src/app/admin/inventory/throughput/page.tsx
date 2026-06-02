import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw } from '@/lib/neon-client';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/pane-header';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory/throughput
 *
 * Diagnostic aggregation: events/hour by station + actor over the
 * last 24 or 72 hours. Pure read; no flag gate (numbers might be
 * sparse until phases 2+ are active, but the panel still renders).
 *
 * Query params:
 *   range  '24h' (default) | '72h' | '7d'
 *
 * Sections:
 *   - Totals card (events seen, unique actors, unique units)
 *   - By event_type bar
 *   - By station × hour heatmap (last 24h only — fits a 6×24 grid)
 *   - By actor table
 */

type Range = '24h' | '72h' | '7d';

const RANGE_HOURS: Record<Range, number> = {
  '24h': 24,
  '72h': 72,
  '7d': 168,
};

interface Totals {
  events: number;
  actors: number;
  units: number;
}

interface ByTypeRow {
  event_type: string;
  count: number;
}

interface ByActorRow {
  actor_staff_id: number | null;
  actor_name: string | null;
  count: number;
  last_active: Date | null;
}

interface HourlyRow {
  station: string;
  hour_bucket: Date;
  count: number;
}

async function loadTotals(hours: number): Promise<Totals> {
  try {
    const r = await queryRaw<Totals>(
      `SELECT COUNT(*)::int AS events,
              COUNT(DISTINCT actor_staff_id)::int AS actors,
              COUNT(DISTINCT serial_unit_id)::int AS units
         FROM inventory_events
        WHERE occurred_at > NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return r[0] ?? { events: 0, actors: 0, units: 0 };
  } catch {
    return { events: 0, actors: 0, units: 0 };
  }
}

async function loadByType(hours: number): Promise<ByTypeRow[]> {
  try {
    return await queryRaw<ByTypeRow>(
      `SELECT event_type, COUNT(*)::int AS count
         FROM inventory_events
        WHERE occurred_at > NOW() - ($1::int * INTERVAL '1 hour')
        GROUP BY event_type
        ORDER BY count DESC, event_type ASC`,
      [hours],
    );
  } catch {
    return [];
  }
}

async function loadByActor(hours: number): Promise<ByActorRow[]> {
  try {
    return await queryRaw<ByActorRow>(
      `SELECT ie.actor_staff_id, s.name AS actor_name,
              COUNT(*)::int AS count,
              MAX(ie.occurred_at) AS last_active
         FROM inventory_events ie
         LEFT JOIN staff s ON s.id = ie.actor_staff_id
        WHERE ie.occurred_at > NOW() - ($1::int * INTERVAL '1 hour')
        GROUP BY ie.actor_staff_id, s.name
        ORDER BY count DESC, last_active DESC NULLS LAST
        LIMIT 50`,
      [hours],
    );
  } catch {
    return [];
  }
}

async function loadHourly(hours: number): Promise<HourlyRow[]> {
  try {
    return await queryRaw<HourlyRow>(
      `SELECT COALESCE(station, 'UNKNOWN') AS station,
              date_trunc('hour', occurred_at) AS hour_bucket,
              COUNT(*)::int AS count
         FROM inventory_events
        WHERE occurred_at > NOW() - ($1::int * INTERVAL '1 hour')
        GROUP BY station, hour_bucket
        ORDER BY hour_bucket DESC, station ASC`,
      [hours],
    );
  } catch {
    return [];
  }
}

function isValidRange(value: string | undefined): value is Range {
  return value === '24h' || value === '72h' || value === '7d';
}

export default async function ThroughputPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const range: Range = isValidRange(params.range) ? params.range : '24h';
  const hours = RANGE_HOURS[range];

  const [totals, byType, byActor, hourly] = await Promise.all([
    loadTotals(hours),
    loadByType(hours),
    loadByActor(hours),
    loadHourly(hours),
  ]);

  const maxTypeCount = byType[0]?.count ?? 1;
  const maxHourly = hourly.reduce((m, r) => Math.max(m, r.count), 1);
  const hourlyStations = Array.from(new Set(hourly.map((r) => r.station))).sort();
  const hourlyByCell = new Map(hourly.map((r) => [`${r.station}|${r.hour_bucket.toISOString()}`, r.count]));
  const hourlyBuckets = Array.from(new Set(hourly.map((r) => r.hour_bucket.toISOString()))).sort();

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        backHref="/admin/inventory"
        title="Throughput"
        maxWidth="7xl"
        rightSlot={
          <nav className="flex items-center gap-1 text-xs">
            {(['24h', '72h', '7d'] as const).map((r) => (
              <Link
                key={r}
                href={`/admin/inventory/throughput?range=${r}`}
                className={`rounded-md px-2.5 py-1 font-medium ${
                  range === r
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {r}
              </Link>
            ))}
          </nav>
        }
      />
      <div className="mx-auto max-w-7xl space-y-6 p-8">
        <p className="text-sm text-gray-600">
          Aggregations over <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">inventory_events</code>.
          Numbers stay sparse until the flagged paths start emitting.
        </p>

        {/* Totals */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Tile label="Events" value={totals.events.toLocaleString()} accent="text-blue-700" />
          <Tile label="Distinct actors" value={totals.actors.toLocaleString()} accent="text-emerald-700" />
          <Tile label="Distinct units touched" value={totals.units.toLocaleString()} accent="text-purple-700" />
        </section>

        {/* By event type */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-3">
            <h2 className="text-lg font-medium text-gray-900">By event type</h2>
          </header>
          {byType.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">No events in this range.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {byType.map((t) => (
                <li key={t.event_type} className="flex items-center gap-4 px-6 py-2">
                  <code className="w-44 shrink-0 font-mono text-xs text-gray-700">{t.event_type}</code>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${(t.count / maxTypeCount) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Station × hour heatmap */}
        {hourly.length > 0 ? (
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <header className="border-b border-gray-100 px-6 py-3">
              <h2 className="text-lg font-medium text-gray-900">Station × hour</h2>
              <p className="mt-1 text-xs text-gray-500">
                Heatmap intensity ∝ count. Hover for tooltip; cells with 0 events are blank.
              </p>
            </header>
            <div className="overflow-x-auto px-6 py-4">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-gray-500">Station</th>
                    {hourlyBuckets.map((iso) => (
                      <th key={iso} className="px-1 py-1 text-center font-normal text-micro text-gray-400">
                        {new Date(iso).toLocaleTimeString([], { hour: 'numeric', hour12: true })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hourlyStations.map((station) => (
                    <tr key={station}>
                      <td className="px-2 py-1 font-mono text-caption text-gray-700">{station}</td>
                      {hourlyBuckets.map((iso) => {
                        const count = hourlyByCell.get(`${station}|${iso}`) ?? 0;
                        const intensity = count === 0 ? 0 : Math.max(0.1, count / maxHourly);
                        return (
                          <td key={iso} className="p-0.5">
                            <div
                              className="h-6 w-6 rounded"
                              style={{
                                backgroundColor: count === 0 ? '#f1f5f9' : `rgba(37, 99, 235, ${intensity.toFixed(2)})`,
                              }}
                              title={`${station} @ ${new Date(iso).toLocaleString()}: ${count}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* By actor */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-3">
            <h2 className="text-lg font-medium text-gray-900">By actor</h2>
          </header>
          {byActor.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">No actors in this range.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-2 text-left font-medium">Actor</th>
                  <th className="px-6 py-2 text-right font-medium">Events</th>
                  <th className="px-6 py-2 text-left font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byActor.map((a) => (
                  <tr key={String(a.actor_staff_id)}>
                    <td className="px-6 py-2 text-xs text-gray-700">
                      {a.actor_name ?? (a.actor_staff_id ? `#${a.actor_staff_id}` : 'system')}
                    </td>
                    <td className="px-6 py-2 text-right text-sm font-semibold tabular-nums">{a.count}</td>
                    <td className="px-6 py-2 text-xs text-gray-500">{a.last_active ? new Date(a.last_active).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
