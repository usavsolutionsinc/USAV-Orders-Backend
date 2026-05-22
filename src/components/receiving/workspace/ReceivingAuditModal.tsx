'use client';

import { useEffect, useState } from 'react';
import { X } from '@/components/Icons';
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

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <>
      {/* Full-viewport dim — covers the page sidebar too. */}
      <div
        className="fixed inset-0 z-[198] bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      {/* Dialog layer — absolute inset-0 anchors to the workspace overlay
          (which fills the right-pane), centering the dialog over the
          receiving content. The flex container passes clicks through; the
          dialog itself stops them so backdrop dismissal still works. */}
      <div
        className="pointer-events-none absolute inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="receiving-audit-title"
        className="pointer-events-auto flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col rounded-t-xl border border-slate-200 bg-white shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div className="min-w-0">
            <p
              id="receiving-audit-title"
              className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500"
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
            <p className="py-6 text-center text-[11px] text-slate-500">Loading activity…</p>
          ) : error ? (
            <p className="py-6 text-center text-[11px] font-medium text-rose-600">{error}</p>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-slate-500">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-[11px]">
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
                    <p className="text-[10px] tabular-nums text-slate-400">
                      {formatDateTimePST(ev.occurred_at)}
                    </p>
                    {ev.notes ? (
                      <p className="mt-0.5 italic text-slate-600">{ev.notes}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
