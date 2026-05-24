'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatPSTTimestamp } from '@/utils/date';
import { ClipboardList, User, Camera, Box, Package, AlertTriangle } from '@/components/Icons';

// ─── Types (mirror aggregator) ─────────────────────────────────────────────

interface POSummary {
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  line_count: number;
  carton_count: number;
  quantity_expected: number;
  quantity_received: number;
  workflow_counts: Record<string, number>;
  latest_event_at: string | null;
  last_actor_name: string | null;
}

interface Photo {
  id: number;
  url: string;
  photo_type: string | null;
  taken_at: string;
  taken_by: number | null;
  taken_by_name: string | null;
}

interface Carton {
  id: number;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  received_at: string | null;
  received_by_name: string | null;
  unboxed_at: string | null;
  unboxed_by_name: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  is_return: boolean;
  return_platform: string | null;
  return_reason: string | null;
  target_channel: string | null;
  assigned_tech_name: string | null;
  zoho_purchase_receive_id: string | null;
  support_notes: string | null;
  photos: Photo[];
}

interface Serial {
  id: number;
  serial_number: string;
  current_status: string | null;
  current_location: string | null;
  received_at: string | null;
  received_by_name: string | null;
}

interface Line {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string;
  quantity_expected: number | null;
  quantity_received: number | null;
  workflow_status: string;
  qa_status: string;
  disposition_code: string;
  condition_grade: string;
  disposition_final: string | null;
  needs_test: boolean;
  assigned_tech_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  zoho_synced_at: string | null;
  serials: Serial[];
}

interface AuditEvent {
  id: string;
  occurred_at: string;
  source: string;
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  receiving_id: number | null;
  receiving_line_id: number | null;
  serial_unit_id: number | null;
  serial_number: string | null;
  bin_id: number | null;
  bin_name: string | null;
  sku: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

interface PODetail {
  po: { po_id: string; po_number: string | null; vendor_name: string | null };
  cartons: Carton[];
  lines: Line[];
  events: AuditEvent[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatPSTTimestamp(new Date(iso));
  } catch {
    return iso;
  }
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Date.now() - d;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

const KIND_META: Record<string, { label: string; tone: string; icon: 'box' | 'check' | 'photo' | 'user' | 'warn' | 'tag' | 'sync' }> = {
  CARTON_CREATED:      { label: 'Package created',     tone: 'bg-slate-100 text-slate-700 ring-slate-200',   icon: 'box' },
  CARTON_RECEIVED:     { label: 'Package received',    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'check' },
  CARTON_UNBOXED:      { label: 'Package unboxed',     tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'box' },
  LINE_CREATED:        { label: 'Line synced',        tone: 'bg-slate-100 text-slate-700 ring-slate-200',   icon: 'sync' },
  RECEIVED:            { label: 'Line received',      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'check' },
  TEST_START:          { label: 'Test started',       tone: 'bg-amber-50 text-amber-700 ring-amber-200',    icon: 'warn' },
  TEST_PASS:           { label: 'Test passed',        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'check' },
  TEST_FAIL:           { label: 'Test failed',        tone: 'bg-rose-50 text-rose-700 ring-rose-200',       icon: 'warn' },
  PUTAWAY:             { label: 'Put away in bin',    tone: 'bg-violet-50 text-violet-700 ring-violet-200', icon: 'tag' },
  MOVED:               { label: 'Moved to new bin',   tone: 'bg-violet-50 text-violet-700 ring-violet-200', icon: 'tag' },
  PICKED:              { label: 'Picked',             tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'tag' },
  PACKED:              { label: 'Packed',             tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'tag' },
  SHIPPED:             { label: 'Shipped',            tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200', icon: 'tag' },
  ADJUSTED:            { label: 'Stock adjusted',     tone: 'bg-amber-50 text-amber-700 ring-amber-200',    icon: 'warn' },
  RETURNED:            { label: 'Returned',           tone: 'bg-amber-50 text-amber-700 ring-amber-200',    icon: 'warn' },
  SCRAPPED:            { label: 'Scrapped',           tone: 'bg-rose-50 text-rose-700 ring-rose-200',       icon: 'warn' },
  NOTE:                { label: 'Note',               tone: 'bg-slate-100 text-slate-700 ring-slate-200',   icon: 'tag' },
  DISPOSITION_CHANGED: { label: 'Disposition changed', tone: 'bg-amber-50 text-amber-700 ring-amber-200',   icon: 'tag' },
  PHOTO_ADDED:         { label: 'Photo added',        tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'photo' },
};

function kindMeta(kind: string) {
  return (
    KIND_META[kind] ?? {
      label: kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      tone: 'bg-slate-100 text-slate-700 ring-slate-200',
      icon: 'tag' as const,
    }
  );
}

function KindIcon({ name }: { name: 'box' | 'check' | 'photo' | 'user' | 'warn' | 'tag' | 'sync' }) {
  const cls = 'w-3.5 h-3.5';
  switch (name) {
    case 'box':   return <Box className={cls} />;
    case 'photo': return <Camera className={cls} />;
    case 'user':  return <User className={cls} />;
    case 'warn':  return <AlertTriangle className={cls} />;
    case 'sync':  return <Package className={cls} />;
    case 'check': return (
      <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
    );
    case 'tag':
    default:
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/></svg>
      );
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AuditLogReceivingClient() {
  const searchParams = useSearchParams();
  const selectedPo = searchParams.get('po');
  const [detail, setDetail] = useState<PODetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPo) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setError(null);
    fetch(`/api/audit-log/receiving?po=${encodeURIComponent(selectedPo)}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setDetail(d as PODetail);
        else setError(d?.error ?? 'Failed to load PO detail');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedPo]);

  return (
    <div className="flex h-full w-full overflow-y-auto">
      {error ? (
        <div className="m-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : !selectedPo ? (
        <EmptyState />
      ) : detailLoading ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
          Loading PO timeline…
        </div>
      ) : detail ? (
        <div className="w-full">
          <PODetailView detail={detail} />
        </div>
      ) : null}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <ClipboardList className="h-10 w-10 text-emerald-200" />
      <div className="mt-3 text-base font-medium text-slate-800">
        Pick a purchase order
      </div>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Select a PO from the list to see every event captured for it — when each
        package arrived, when each line item was unboxed, tested, dispositioned,
        and put away.
      </p>
    </div>
  );
}

// ─── PO detail view ────────────────────────────────────────────────────────

function PODetailView({ detail }: { detail: PODetail }) {
  const { po, cartons, lines, events } = detail;
  const [activeTab, setActiveTab] = useState<'timeline' | 'cartons' | 'lines'>('timeline');

  const totals = useMemo(() => {
    const expected = lines.reduce((s, l) => s + (l.quantity_expected ?? 0), 0);
    const received = lines.reduce((s, l) => s + (l.quantity_received ?? 0), 0);
    const byStatus: Record<string, number> = {};
    for (const l of lines) byStatus[l.workflow_status] = (byStatus[l.workflow_status] ?? 0) + 1;
    return { expected, received, byStatus };
  }, [lines]);

  return (
    <div className="px-6 py-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">
            Purchase Order
          </div>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">
            {po.po_number ?? po.po_id}
          </h2>
          {po.vendor_name && (
            <div className="text-sm text-slate-500">{po.vendor_name}</div>
          )}
          <div className="mt-1 text-caption text-slate-400">
            Zoho PO id: <code className="font-mono">{po.po_id}</code>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <Stat label="Packages" value={cartons.length} />
          <Stat label="Lines" value={lines.length} />
          <Stat label="Received / Expected" value={`${totals.received} / ${totals.expected}`} />
        </div>
      </header>

      {/* Workflow chips */}
      {Object.keys(totals.byStatus).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(totals.byStatus).map(([status, n]) => (
            <span
              key={status}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-caption font-medium text-slate-700"
            >
              <span className="font-semibold">{n}</span>
              <span className="text-slate-500">{status}</span>
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <nav className="mt-5 flex gap-1 border-b border-slate-200">
        {([
          ['timeline', `Timeline (${events.length})`],
          ['cartons',  `Packages (${cartons.length})`],
          ['lines',    `Lines (${lines.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              activeTab === key
                ? 'border-emerald-500 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {activeTab === 'timeline' && <TimelineList events={events} />}
        {activeTab === 'cartons' && <CartonsList cartons={cartons} />}
        {activeTab === 'lines' && <LinesList lines={lines} events={events} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
    </div>
  );
}

// ─── Timeline ──────────────────────────────────────────────────────────────

function TimelineList({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">No events yet.</div>;
  }
  return (
    <ol className="relative space-y-3">
      {events.map((ev) => (
        <li key={ev.id}>
          <EventCard event={ev} />
        </li>
      ))}
    </ol>
  );
}

function EventCard({ event: ev }: { event: AuditEvent }) {
  const meta = kindMeta(ev.kind);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full ring-1 ${meta.tone}`}>
            <KindIcon name={meta.icon} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium text-slate-900">{meta.label}</span>
              {ev.sku && (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-caption font-mono text-slate-700">
                  {ev.sku}
                </code>
              )}
              {ev.station && (
                <span className="text-caption uppercase tracking-wide text-slate-400">
                  {ev.station}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span title={ev.occurred_at}>{fmtTime(ev.occurred_at)}</span>
              <span>·</span>
              <span className="text-slate-400">{relTime(ev.occurred_at)}</span>
              {ev.actor_name && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {ev.actor_name}
                  </span>
                </>
              )}
              {ev.receiving_line_id != null && (
                <>
                  <span>·</span>
                  <span>line #{ev.receiving_line_id}</span>
                </>
              )}
              {ev.receiving_id != null && (
                <>
                  <span>·</span>
                  <span>package #{ev.receiving_id}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status transitions */}
      {(ev.before || ev.after) && (ev.before || ev.after) && (
        <DiffBox before={ev.before} after={ev.after} />
      )}

      {/* Bin transitions */}
      {(ev.bin_name || ev.bin_id != null) && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-800 ring-1 ring-violet-100">
          <span>Bin:</span>
          <span className="font-medium">{ev.bin_name ?? `#${ev.bin_id}`}</span>
        </div>
      )}

      {/* Serial */}
      {ev.serial_number && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 ring-1 ring-sky-100">
          <span>Serial:</span>
          <span className="font-mono">{ev.serial_number}</span>
        </div>
      )}

      {ev.notes && (
        <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {ev.notes}
        </div>
      )}

      {/* Photo preview */}
      {ev.kind === 'PHOTO_ADDED' && typeof ev.detail?.url === 'string' && (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ev.detail.url as string}
            alt="Receiving photo"
            className="max-h-40 rounded-md border border-slate-200 object-cover"
          />
        </div>
      )}

      {/* Raw detail (collapsible) */}
      {hasNonTrivialDetail(ev.detail) && <RawDetail detail={ev.detail} />}
    </div>
  );
}

function hasNonTrivialDetail(d: Record<string, unknown>): boolean {
  if (!d) return false;
  const keys = Object.keys(d).filter((k) => d[k] != null && d[k] !== '' && k !== 'url');
  return keys.length > 0;
}

function RawDetail({ detail }: { detail: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-2"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none text-caption text-slate-400 hover:text-slate-600">
        {open ? 'hide raw payload' : 'show raw payload'}
      </summary>
      <pre className="mt-1 overflow-x-auto rounded bg-slate-50 px-2 py-1.5 text-caption leading-snug text-slate-700">
        {JSON.stringify(detail, null, 2)}
      </pre>
    </details>
  );
}

function DiffBox({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = Array.from(
    new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]),
  );
  if (keys.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-1 rounded-md bg-slate-50 p-2 text-xs sm:grid-cols-[auto_1fr]">
      {keys.map((k) => {
        const b = before?.[k];
        const a = after?.[k];
        if (b == null && a == null) return null;
        return (
          <div key={k} className="contents">
            <span className="font-medium text-slate-500">{k}</span>
            <span className="text-slate-800">
              {b != null && (
                <span className="rounded bg-rose-100 px-1 py-0.5 text-rose-700 line-through">
                  {String(b)}
                </span>
              )}
              {b != null && a != null && <span className="mx-1 text-slate-400">→</span>}
              {a != null && (
                <span className="rounded bg-emerald-100 px-1 py-0.5 text-emerald-800">
                  {String(a)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Cartons list ──────────────────────────────────────────────────────────

function CartonsList({ cartons }: { cartons: Carton[] }) {
  if (cartons.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">No packages matched yet.</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {cartons.map((c) => (
        <article key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <header className="flex items-start justify-between gap-2">
            <div>
              <div className="text-caption uppercase tracking-wider text-slate-400">
                Package #{c.id}
              </div>
              <div className="mt-0.5 truncate font-mono text-sm font-medium text-slate-900">
                {c.tracking_number ?? '—'}
              </div>
              {c.carrier && (
                <div className="text-xs text-slate-500">{c.carrier}</div>
              )}
            </div>
            {c.is_return && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-caption font-medium text-amber-700 ring-1 ring-amber-100">
                Return{c.return_platform ? ` · ${c.return_platform}` : ''}
              </span>
            )}
          </header>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <KV label="Created"  value={fmtTime(c.created_at)} />
            <KV label="Received" value={c.received_at ? `${fmtTime(c.received_at)}${c.received_by_name ? ` · ${c.received_by_name}` : ''}` : '—'} />
            <KV label="Unboxed"  value={c.unboxed_at ? `${fmtTime(c.unboxed_at)}${c.unboxed_by_name ? ` · ${c.unboxed_by_name}` : ''}` : '—'} />
            <KV label="QA"       value={c.qa_status ?? '—'} />
            <KV label="Disposition" value={c.disposition_code ?? '—'} />
            <KV label="Condition"   value={c.condition_grade ?? '—'} />
            {c.return_reason && <KV label="Return reason" value={c.return_reason} span2 />}
            {c.assigned_tech_name && <KV label="Tech" value={c.assigned_tech_name} />}
            {c.target_channel && <KV label="Channel" value={c.target_channel} />}
            {c.zoho_purchase_receive_id && (
              <KV label="Zoho receive id" value={c.zoho_purchase_receive_id} span2 />
            )}
            {c.support_notes && (
              <KV label="Notes" value={c.support_notes} span2 />
            )}
          </dl>

          {c.photos.length > 0 && (
            <div className="mt-3">
              <div className="text-caption uppercase tracking-wider text-slate-400">
                Photos ({c.photos.length})
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {c.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.photo_type ?? 'photo'}
                      title={`${p.taken_by_name ?? 'Unknown'} · ${fmtTime(p.taken_at)}`}
                      className="h-16 w-16 rounded-md border border-slate-200 object-cover transition group-hover:ring-2 group-hover:ring-emerald-300"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function KV({ label, value, span2 = false }: { label: string; value: string; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <dt className="text-micro uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

// ─── Lines list ────────────────────────────────────────────────────────────

function LinesList({ lines, events }: { lines: Line[]; events: AuditEvent[] }) {
  const eventsByLine = useMemo(() => {
    const map = new Map<number, AuditEvent[]>();
    for (const e of events) {
      if (e.receiving_line_id == null) continue;
      const list = map.get(e.receiving_line_id) ?? [];
      list.push(e);
      map.set(e.receiving_line_id, list);
    }
    return map;
  }, [events]);

  if (lines.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">No lines on this PO.</div>;
  }

  return (
    <div className="space-y-3">
      {lines.map((l) => (
        <LineCard key={l.id} line={l} events={eventsByLine.get(l.id) ?? []} />
      ))}
    </div>
  );
}

function LineCard({ line: l, events }: { line: Line; events: AuditEvent[] }) {
  const [open, setOpen] = useState(false);
  const received = l.quantity_received ?? 0;
  const expected = l.quantity_expected ?? 0;
  const complete = expected > 0 && received >= expected;

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50/60"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-caption uppercase tracking-wider text-slate-400">
              Line #{l.id}
            </span>
            {l.sku && (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-caption font-mono text-slate-700">
                {l.sku}
              </code>
            )}
            <span className="text-sm font-medium text-slate-900 truncate">
              {l.item_name ?? '—'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-slate-500">
            <span className={complete ? 'font-medium text-emerald-700' : ''}>
              {received} / {expected}
            </span>
            <span>·</span>
            <WorkflowBadge status={l.workflow_status} />
            <QABadge status={l.qa_status} />
            <DispositionBadge code={l.disposition_code} />
            {l.condition_grade && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-micro font-medium text-slate-700">
                {l.condition_grade}
              </span>
            )}
            {l.assigned_tech_name && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" />
                {l.assigned_tech_name}
              </span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 text-slate-400 transition ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <KV label="Created"        value={fmtTime(l.created_at)} />
            <KV label="Updated"        value={fmtTime(l.updated_at)} />
            <KV label="Zoho synced"    value={fmtTime(l.zoho_synced_at)} />
            <KV label="Needs test"     value={l.needs_test ? 'Yes' : 'No'} />
            <KV label="Final dispo"    value={l.disposition_final ?? '—'} />
            <KV label="Zoho item id"   value={l.zoho_item_id} />
            {l.receiving_id != null && <KV label="Package" value={`#${l.receiving_id}`} />}
            {l.notes && <KV label="Notes" value={l.notes} span2 />}
          </dl>

          {l.serials.length > 0 && (
            <div className="mt-3">
              <div className="text-caption uppercase tracking-wider text-slate-400">
                Serials ({l.serials.length})
              </div>
              <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-100 bg-slate-50/40">
                {l.serials.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <code className="font-mono text-slate-800">{s.serial_number}</code>
                    <div className="flex flex-wrap items-center gap-2 text-slate-500">
                      {s.current_status && (
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-micro ring-1 ring-slate-200">
                          {s.current_status}
                        </span>
                      )}
                      {s.current_location && (
                        <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-micro text-violet-800 ring-1 ring-violet-100">
                          {s.current_location}
                        </span>
                      )}
                      {s.received_at && (
                        <span title={s.received_at}>
                          {relTime(s.received_at)}
                          {s.received_by_name ? ` · ${s.received_by_name}` : ''}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <div className="text-caption uppercase tracking-wider text-slate-400">
              Events ({events.length})
            </div>
            <div className="mt-1 space-y-2">
              {events.length === 0 ? (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No line-level events recorded yet.
                </div>
              ) : (
                events.map((e) => <EventCard key={e.id} event={e} />)
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function WorkflowBadge({ status }: { status: string }) {
  const TONE: Record<string, string> = {
    EXPECTED:      'bg-slate-100 text-slate-700',
    ARRIVED:       'bg-sky-50 text-sky-700',
    MATCHED:       'bg-sky-50 text-sky-700',
    UNBOXED:       'bg-violet-50 text-violet-700',
    AWAITING_TEST: 'bg-amber-50 text-amber-700',
    IN_TEST:       'bg-amber-50 text-amber-700',
    PASSED:        'bg-emerald-50 text-emerald-700',
    FAILED:        'bg-rose-50 text-rose-700',
    RTV:           'bg-amber-50 text-amber-700',
    SCRAP:         'bg-rose-50 text-rose-700',
    DONE:          'bg-emerald-100 text-emerald-800',
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${TONE[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
}

function QABadge({ status }: { status: string }) {
  if (!status || status === 'PENDING') return null;
  const TONE: Record<string, string> = {
    PASSED:           'bg-emerald-50 text-emerald-700',
    FAILED_DAMAGED:   'bg-rose-50 text-rose-700',
    FAILED_INCOMPLETE:'bg-amber-50 text-amber-700',
    FAILED_FUNCTIONAL:'bg-rose-50 text-rose-700',
    HOLD:             'bg-amber-50 text-amber-700',
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${TONE[status] ?? 'bg-slate-100 text-slate-700'}`}>
      QA: {status}
    </span>
  );
}

function DispositionBadge({ code }: { code: string }) {
  if (!code || code === 'HOLD') return null;
  const TONE: Record<string, string> = {
    ACCEPT: 'bg-emerald-50 text-emerald-700',
    RTV:    'bg-amber-50 text-amber-700',
    SCRAP:  'bg-rose-50 text-rose-700',
    REWORK: 'bg-sky-50 text-sky-700',
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${TONE[code] ?? 'bg-slate-100 text-slate-700'}`}>
      {code}
    </span>
  );
}
