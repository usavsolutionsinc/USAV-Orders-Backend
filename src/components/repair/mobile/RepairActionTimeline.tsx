'use client';

import { useCallback, useEffect, useState } from 'react';
import { repairActionTypeToneClass } from '@/lib/repair-action-type-tone';

interface RepairAction {
  id: number;
  repair_id: number;
  action_type: string;
  part_name: string | null;
  old_sku: string | null;
  new_sku: string | null;
  old_serial: string | null;
  new_serial: string | null;
  duration_min: number | null;
  notes: string | null;
  staff_id: number | null;
  staff_name: string | null;
  created_at: string;
}

interface Props {
  repairId: number;
  /** Bump this to force a refetch (e.g. after Add sheet saves). */
  refreshKey: number;
}

const TYPE_LABEL: Record<string, string> = {
  replaced: 'Replaced',
  repaired: 'Repaired',
  cleaned: 'Cleaned',
  tested: 'Tested',
  no_fix: 'No fix',
  awaiting_part: 'Awaiting part',
};

const TYPE_EMOJI: Record<string, string> = {
  replaced: '🔁',
  repaired: '🔧',
  cleaned: '🧼',
  tested: '✅',
  no_fix: '❌',
  awaiting_part: '⏸',
};

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RepairActionTimeline({ repairId, refreshKey }: Props) {
  const [actions, setActions] = useState<RepairAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/repair/actions?repairId=${repairId}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setActions(Array.isArray(body?.actions) ? body.actions : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section>
      <div className="px-1 mb-2 flex items-baseline justify-between">
        <p className="text-micro font-black uppercase tracking-[0.16em] text-text-soft">
          What was repaired
        </p>
        <span className="text-micro font-bold text-text-faint">
          {actions.length} action{actions.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {loading && actions.length === 0 && (
        <p className="text-center text-sm font-semibold text-text-soft py-6">Loading…</p>
      )}

      {!loading && actions.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border-default bg-surface-card p-6 text-center">
          <p className="text-sm font-bold text-text-muted">No actions logged yet.</p>
          <p className="mt-1 text-caption text-text-soft">
            Tap the + button to record the first one.
          </p>
        </div>
      )}

      {actions.length > 0 && (
        <ul className="space-y-2">
          {actions.map((a) => {
            const tone = repairActionTypeToneClass(a.action_type);
            const hasReplacement =
              a.action_type === 'replaced' && (a.old_sku || a.new_sku || a.old_serial || a.new_serial);
            return (
              <li
                key={a.id}
                className={`rounded-lg border ${tone} p-3 shadow-sm`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl leading-none shrink-0" aria-hidden>
                    {TYPE_EMOJI[a.action_type] || '•'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-black text-text-default">
                        {TYPE_LABEL[a.action_type] || a.action_type}
                        {a.part_name ? (
                          <span className="ml-1.5 font-bold text-text-muted">— {a.part_name}</span>
                        ) : null}
                      </p>
                      <span className="text-micro font-bold text-text-soft shrink-0">
                        {formatAgo(a.created_at)}
                      </span>
                    </div>

                    {hasReplacement && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-caption font-mono">
                        {a.old_sku && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700 line-through">
                            {a.old_sku}
                          </span>
                        )}
                        {(a.old_sku || a.old_serial) && (a.new_sku || a.new_serial) && (
                          <span className="text-text-faint">→</span>
                        )}
                        {a.new_sku && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                            {a.new_sku}
                          </span>
                        )}
                      </div>
                    )}

                    {(a.old_serial || a.new_serial) && (
                      <div className="mt-1 flex items-center gap-1.5 text-micro font-mono text-text-muted">
                        {a.old_serial && <span>SN: {a.old_serial}</span>}
                        {a.old_serial && a.new_serial && <span className="text-text-faint">→</span>}
                        {a.new_serial && <span>SN: {a.new_serial}</span>}
                      </div>
                    )}

                    {a.notes && (
                      <p className="mt-1.5 text-label text-text-muted leading-snug whitespace-pre-wrap">
                        {a.notes}
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-2 text-micro font-bold text-text-soft">
                      {a.staff_name && <span>{a.staff_name}</span>}
                      {a.duration_min != null && (
                        <>
                          {a.staff_name && <span className="text-text-faint">·</span>}
                          <span>{a.duration_min} min</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
