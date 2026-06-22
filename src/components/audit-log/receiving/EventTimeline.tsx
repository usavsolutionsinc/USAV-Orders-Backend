import { useState } from 'react';
import { User } from '@/components/Icons';
import { fmtTime, hasNonTrivialDetail, kindMeta, KindIcon, relTime } from './audit-receiving-format';
import type { AuditEvent } from './audit-receiving-types';

export function TimelineList({ events }: { events: AuditEvent[] }) {
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

export function EventCard({ event: ev }: { event: AuditEvent }) {
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
              {ev.sku && <code className="rounded bg-slate-100 px-1.5 py-0.5 text-caption font-mono text-slate-700">{ev.sku}</code>}
              {ev.station && <span className="text-caption uppercase tracking-wide text-slate-400">{ev.station}</span>}
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

      {(ev.before || ev.after) && (ev.before || ev.after) && <DiffBox before={ev.before} after={ev.after} />}

      {(ev.bin_name || ev.bin_id != null) && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-800 ring-1 ring-violet-100">
          <span>Bin:</span>
          <span className="font-medium">{ev.bin_name ?? `#${ev.bin_id}`}</span>
        </div>
      )}

      {ev.serial_number && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 ring-1 ring-sky-100">
          <span>Serial:</span>
          <span className="font-mono">{ev.serial_number}</span>
        </div>
      )}

      {ev.notes && <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">{ev.notes}</div>}

      {ev.kind === 'PHOTO_ADDED' && typeof ev.detail?.url === 'string' && (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ev.detail.url as string} alt="Receiving photo" className="max-h-40 rounded-md border border-slate-200 object-cover" />
        </div>
      )}

      {hasNonTrivialDetail(ev.detail) && <RawDetail detail={ev.detail} />}
    </div>
  );
}

function RawDetail({ detail }: { detail: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-2" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none text-caption text-slate-400 hover:text-slate-600">
        {open ? 'hide raw payload' : 'show raw payload'}
      </summary>
      <pre className="mt-1 overflow-x-auto rounded bg-slate-50 px-2 py-1.5 text-caption leading-snug text-slate-700">
        {JSON.stringify(detail, null, 2)}
      </pre>
    </details>
  );
}

function DiffBox({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = Array.from(new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]));
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
              {b != null && <span className="rounded bg-rose-100 px-1 py-0.5 text-rose-700 line-through">{String(b)}</span>}
              {b != null && a != null && <span className="mx-1 text-slate-400">→</span>}
              {a != null && <span className="rounded bg-emerald-100 px-1 py-0.5 text-emerald-800">{String(a)}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
