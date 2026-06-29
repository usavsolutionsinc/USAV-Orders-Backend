import { fmtTime } from './audit-receiving-format';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { KV } from './AuditPrimitives';
import type { Carton } from './audit-receiving-types';

export function CartonsList({ cartons }: { cartons: Carton[] }) {
  if (cartons.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">No packages matched yet.</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {cartons.map((c) => (
        <article key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <header className="flex items-start justify-between gap-2">
            <div>
              <div className="text-caption uppercase tracking-wider text-slate-400">Package #{c.id}</div>
              <div className="mt-0.5 truncate font-mono text-sm font-medium text-slate-900">{c.tracking_number ?? '—'}</div>
              {c.carrier && <div className="text-xs text-slate-500">{c.carrier}</div>}
            </div>
            {c.is_return && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-caption font-medium text-amber-700 ring-1 ring-amber-100">
                Return{c.return_platform ? ` · ${c.return_platform}` : ''}
              </span>
            )}
          </header>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <KV label="Created" value={fmtTime(c.created_at)} />
            <KV label="Received" value={c.received_at ? `${fmtTime(c.received_at)}${c.received_by_name ? ` · ${c.received_by_name}` : ''}` : '—'} />
            <KV label="Unboxed" value={c.unboxed_at ? `${fmtTime(c.unboxed_at)}${c.unboxed_by_name ? ` · ${c.unboxed_by_name}` : ''}` : '—'} />
            <KV label="QA" value={c.qa_status ?? '—'} />
            <KV label="Disposition" value={c.disposition_code ?? '—'} />
            <KV label="Condition" value={c.condition_grade ?? '—'} />
            {c.return_reason && <KV label="Return reason" value={c.return_reason} span2 />}
            {c.assigned_tech_name && <KV label="Tech" value={c.assigned_tech_name} />}
            {c.target_channel && <KV label="Channel" value={c.target_channel} />}
            {c.zoho_purchase_receive_id && <KV label="Zoho receive id" value={c.zoho_purchase_receive_id} span2 />}
            {c.support_notes && <KV label="Notes" value={c.support_notes} span2 />}
          </dl>

          {c.photos.length > 0 && (
            <div className="mt-3">
              <div className="text-caption uppercase tracking-wider text-slate-400">Photos ({c.photos.length})</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {c.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group">
                    <HoverTooltip label={`${p.taken_by_name ?? 'Unknown'} · ${fmtTime(p.taken_at)}`} asChild focusable={false}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt={p.photo_type ?? 'photo'}
                        className="h-16 w-16 rounded-md border border-slate-200 object-cover transition group-hover:ring-2 group-hover:ring-emerald-300"
                      />
                    </HoverTooltip>
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
