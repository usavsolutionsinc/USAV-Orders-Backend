import { useMemo, useState } from 'react';
import { User } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { fmtTime, relTime } from './audit-receiving-format';
import { DispositionBadge, KV, QABadge, WorkflowBadge } from './AuditPrimitives';
import { EventCard } from './EventTimeline';
import type { AuditEvent, Line } from './audit-receiving-types';

export function LinesList({ lines, events }: { lines: Line[]; events: AuditEvent[] }) {
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
    return <div className="py-8 text-center text-sm text-text-faint">No lines on this PO.</div>;
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
    <article className="rounded-lg border border-border-soft bg-surface-card shadow-sm">
      <button onClick={() => setOpen((v) => !v)} className="ds-raw-button flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-canvas/60">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-caption uppercase tracking-wider text-text-faint">Line #{l.id}</span>
            {l.sku && <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-caption font-mono text-text-muted">{l.sku}</code>}
            <span className="text-sm font-medium text-text-default truncate">{l.item_name ?? '—'}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-soft">
            <span className={complete ? 'font-medium text-emerald-700' : ''}>{received} / {expected}</span>
            <span>·</span>
            <WorkflowBadge status={l.workflow_status} />
            <QABadge status={l.qa_status} />
            <DispositionBadge code={l.disposition_code} />
            {l.condition_grade && <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-micro font-medium text-text-muted">{l.condition_grade}</span>}
            {l.assigned_tech_name && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" />
                {l.assigned_tech_name}
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-text-faint transition ${open ? 'rotate-90' : ''}`} aria-hidden>▸</span>
      </button>

      {open && (
        <div className="border-t border-border-hairline px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <KV label="Created" value={fmtTime(l.created_at)} />
            <KV label="Updated" value={fmtTime(l.updated_at)} />
            <KV label="Zoho synced" value={fmtTime(l.zoho_synced_at)} />
            <KV label="Needs test" value={l.needs_test ? 'Yes' : 'No'} />
            <KV label="Final dispo" value={l.disposition_final ?? '—'} />
            <KV label="Zoho item id" value={l.zoho_item_id} />
            {l.receiving_id != null && <KV label="Package" value={`#${l.receiving_id}`} />}
            {l.notes && <KV label="Notes" value={l.notes} span2 />}
          </dl>

          {l.serials.length > 0 && (
            <div className="mt-3">
              <div className="text-caption uppercase tracking-wider text-text-faint">Serials ({l.serials.length})</div>
              <ul className="mt-1 divide-y divide-border-hairline rounded-md border border-border-hairline bg-surface-canvas/40">
                {l.serials.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <code className="font-mono text-text-default">{s.serial_number}</code>
                    <div className="flex flex-wrap items-center gap-2 text-text-soft">
                      {s.current_status && <span className="rounded-full bg-surface-card px-1.5 py-0.5 text-micro ring-1 ring-border-soft">{s.current_status}</span>}
                      {s.current_location && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-micro text-violet-800 ring-1 ring-violet-100">{s.current_location}</span>}
                      {s.received_at && (
                        <HoverTooltip label={s.received_at} asChild>
                          <span>
                            {relTime(s.received_at)}
                            {s.received_by_name ? ` · ${s.received_by_name}` : ''}
                          </span>
                        </HoverTooltip>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <div className="text-caption uppercase tracking-wider text-text-faint">Events ({events.length})</div>
            <div className="mt-1 space-y-2">
              {events.length === 0 ? (
                <div className="rounded-md bg-surface-canvas px-3 py-2 text-xs text-text-soft">No line-level events recorded yet.</div>
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
