'use client';

import { useEffect, useMemo, useState } from 'react';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { fieldLabel } from '@/design-system/tokens/typography/presets';
import { User } from '@/components/Icons';
import { relTime, type POSummary } from './audit-log-panel-shared';

// ─── Receiving PO picker (lives inside the sidebar) ────────────────────────

export function ReceivingPOPicker({
  query,
  selectedPo,
  onSelect,
}: {
  query: string;
  selectedPo: string | null;
  onSelect: (po: string | null) => void;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pos, setPos] = useState<POSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/receiving', window.location.origin);
    if (debouncedQuery) url.searchParams.set('q', debouncedQuery);
    url.searchParams.set('limit', '50');
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setPos(d.items ?? []);
        else setError(d?.error ?? 'Failed to load POs');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const list = useMemo(() => pos, [pos]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : loading ? (
          <div className="p-4 text-center text-caption text-gray-400">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-4 text-center text-caption text-gray-400">No POs found.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {list.map((po) => {
              const isSelected = po.po_id === selectedPo;
              const pct =
                po.quantity_expected > 0
                  ? Math.min(100, Math.round((po.quantity_received / po.quantity_expected) * 100))
                  : 0;
              return (
                <li key={po.po_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(po.po_id)}
                    className={`ds-raw-button w-full ${SIDEBAR_GUTTER} py-2.5 text-left transition ${
                      isSelected
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className={`truncate text-xs font-semibold ${fieldLabel} text-gray-900`}>
                        {po.po_number ?? po.po_id}
                      </div>
                      <div className="shrink-0 text-micro text-gray-400">
                        {relTime(po.latest_event_at)}
                      </div>
                    </div>
                    {po.vendor_name && (
                      <div className="truncate text-caption text-gray-500">{po.vendor_name}</div>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-micro text-gray-500">
                      <span>{po.line_count}L</span>
                      <span>·</span>
                      <span>{po.carton_count}C</span>
                      <span>·</span>
                      <span className="font-semibold text-gray-700">
                        {po.quantity_received}/{po.quantity_expected}
                      </span>
                      {po.last_actor_name && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <User className="h-3 w-3" />
                            <span className="truncate max-w-[70px]">{po.last_actor_name}</span>
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
