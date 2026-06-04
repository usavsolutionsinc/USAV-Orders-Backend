'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from '@/components/Icons';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { formatDateTimePST } from '@/utils/date';

type ReceivingAuditEvent = {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_name: string | null;
  station: string | null;
  bin_name: string | null;
  prev_bin_name: string | null;
  prev_status: string | null;
  next_status: string | null;
  serial_number: string | null;
  notes: string | null;
  receiving_line_id: number | null;
  payload?: Record<string, unknown> | null;
};

function formatTimelineAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Curate the raw event stream for human reading — the API still returns the
 * full record, this only shapes what the panel shows:
 *   1. Drop net-zero workflow flip-flops (a Stage A→B reverted by B→A on the
 *      same line is churn, not history).
 *   2. Coalesce a run of serial RECEIVED events on one line into a single
 *      "Received N serials" group, expandable to the individual serials.
 * Input is newest-first; output preserves that order.
 */
type AuditGroup =
  | { kind: 'event'; event: ReceivingAuditEvent }
  | { kind: 'serial_batch'; key: string; events: ReceivingAuditEvent[]; latest: ReceivingAuditEvent };

function isWorkflowTransition(ev: ReceivingAuditEvent): boolean {
  return (
    ev.event_type === 'NOTE' &&
    (ev.payload?.workflow_transition === true ||
      (ev.prev_status != null && ev.next_status != null))
  );
}

function isReceive(ev: ReceivingAuditEvent): boolean {
  return ev.event_type === 'RECEIVED';
}

function dropFlipFlops(events: ReceivingAuditEvent[]): ReceivingAuditEvent[] {
  const cancelled = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (cancelled.has(a.id) || !isWorkflowTransition(a)) continue;
    // Stream is newest-first: `a` is the later event; find the earlier reverse
    // (B→A undoing A→B) on the same line and cancel the pair.
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (cancelled.has(b.id) || !isWorkflowTransition(b)) continue;
      if (b.receiving_line_id !== a.receiving_line_id) continue;
      if (a.prev_status === b.next_status && a.next_status === b.prev_status) {
        cancelled.add(a.id);
        cancelled.add(b.id);
        break;
      }
    }
  }
  return events.filter((e) => !cancelled.has(e.id));
}

function groupEvents(events: ReceivingAuditEvent[]): AuditGroup[] {
  const pruned = dropFlipFlops(events);
  const groups: AuditGroup[] = [];
  let i = 0;
  while (i < pruned.length) {
    const ev = pruned[i];
    if (isReceive(ev)) {
      const batch: ReceivingAuditEvent[] = [ev];
      let j = i + 1;
      while (
        j < pruned.length &&
        isReceive(pruned[j]) &&
        pruned[j].receiving_line_id === ev.receiving_line_id
      ) {
        batch.push(pruned[j]);
        j += 1;
      }
      if (batch.length > 1) {
        groups.push({ kind: 'serial_batch', key: `batch-${ev.id}`, events: batch, latest: batch[0] });
        i = j;
        continue;
      }
    }
    groups.push({ kind: 'event', event: ev });
    i += 1;
  }
  return groups;
}

interface Props {
  open: boolean;
  onClose: () => void;
  receivingId: number;
}

export function ReceivingAuditModal({ open, onClose, receivingId }: Props) {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ReceivingAuditEvent[]>([]);
  const [cartonLabel, setCartonLabel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupEvents(events), [events]);

  useEffect(() => {
    if (!open || !Number.isFinite(receivingId) || receivingId <= 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/receiving/${receivingId}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        const receiving = data.receiving as { tracking?: string; id?: number } | undefined;
        const tracking = (receiving?.tracking || '').trim();
        setCartonLabel(
          tracking
            ? `Package #${receivingId} · ${tracking}`
            : `Package #${receivingId}`,
        );
        setEvents(
          Array.isArray(data.events) ? (data.events as ReceivingAuditEvent[]) : [],
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load audit log');
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, receivingId]);

  return (
    <RightPaneOverlay open={open} onClose={onClose} align="center" aria-labelledby="receiving-audit-title">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <p
            id="receiving-audit-title"
            className="text-micro font-black uppercase tracking-[0.16em] text-slate-500"
          >
            Audit log
          </p>
          <p className="truncate text-xs font-semibold text-slate-900">{cartonLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close audit log"
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="py-6 text-center text-caption text-slate-500">Loading activity…</p>
        ) : error ? (
          <p className="py-6 text-center text-caption font-medium text-rose-600">{error}</p>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-caption text-slate-500">No activity recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) =>
              g.kind === 'serial_batch' ? (
                <SerialBatchRow key={g.key} group={g} />
              ) : (
                <EventRow key={g.event.id} ev={g.event} />
              ),
            )}
          </ul>
        )}
      </div>
    </RightPaneOverlay>
  );
}

function EventRow({ ev }: { ev: ReceivingAuditEvent }) {
  return (
    <li className="flex items-start gap-2 text-caption">
      <span className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-900">
          {ev.event_type.replace(/_/g, ' ')}
          {ev.bin_name ? (
            <span className="ml-1 font-semibold text-slate-600">→ {ev.bin_name}</span>
          ) : null}
          {ev.prev_bin_name && ev.bin_name && ev.prev_bin_name !== ev.bin_name ? (
            <span className="ml-1 font-normal text-slate-500">
              ({ev.prev_bin_name} → {ev.bin_name})
            </span>
          ) : null}
          {ev.serial_number ? (
            <span className="ml-1 font-mono text-slate-500">· {ev.serial_number}</span>
          ) : null}
        </p>
        <p className="text-slate-500">
          {ev.actor_name || 'Unknown'} · {formatTimelineAgo(ev.occurred_at)} ago
          {ev.station ? ` · ${ev.station}` : ''}
          {ev.receiving_line_id != null ? ` · line ${ev.receiving_line_id}` : ''}
        </p>
        <p className="text-micro tabular-nums text-slate-400">
          {formatDateTimePST(ev.occurred_at)}
        </p>
        {ev.notes ? (
          <p className="mt-0.5 italic text-slate-600">{ev.notes}</p>
        ) : null}
      </div>
    </li>
  );
}

function SerialBatchRow({
  group,
}: {
  group: { events: ReceivingAuditEvent[]; latest: ReceivingAuditEvent };
}) {
  const [expanded, setExpanded] = useState(false);
  const { events, latest } = group;
  const allSerialed = events.every((e) => !!e.serial_number);
  const label = `Received ${events.length} ${allSerialed ? 'serials' : 'units'}`;
  return (
    <li className="flex items-start gap-2 text-caption">
      <span className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-left font-bold text-slate-900 hover:text-slate-700"
          aria-expanded={expanded}
        >
          <span>{label}</span>
          <span className="text-micro font-normal text-slate-400">
            {expanded ? '▾ hide' : '▸ show'}
          </span>
        </button>
        <p className="text-slate-500">
          {latest.actor_name || 'Unknown'} · {formatTimelineAgo(latest.occurred_at)} ago
          {latest.station ? ` · ${latest.station}` : ''}
          {latest.receiving_line_id != null ? ` · line ${latest.receiving_line_id}` : ''}
        </p>
        <p className="text-micro tabular-nums text-slate-400">
          {formatDateTimePST(latest.occurred_at)}
        </p>
        {expanded ? (
          <ul className="mt-1 space-y-0.5 border-l border-slate-200 pl-2">
            {events.map((ev) => (
              <li key={ev.id} className="font-mono text-micro text-slate-600">
                {ev.serial_number ?? 'unit (no serial)'}
                <span className="ml-1 tabular-nums text-slate-400">
                  {formatTimelineAgo(ev.occurred_at)} ago
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
