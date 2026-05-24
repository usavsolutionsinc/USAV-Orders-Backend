'use client';

import { useCallback, useState } from 'react';

interface IntegrationRow {
  provider: string;
  status: string;
  display_label: string | null;
  last_used_at: Date | null;
  last_error: string | null;
  scope: string | null;
  updated_at: Date;
}

interface IntegrationCardProps {
  providerKey: string;
  providerLabel: string;
  description: string;
  row: IntegrationRow | null;
}

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  active:  { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  error:   { dot: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50' },
  revoked: { dot: 'bg-gray-400',    text: 'text-gray-600',    bg: 'bg-gray-100' },
};

export function IntegrationCard({ providerKey, providerLabel, description, row }: IntegrationCardProps) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<string>('{}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = row?.status ?? 'not-configured';
  const style = STATUS_STYLES[status] ?? { dot: 'bg-gray-300', text: 'text-gray-500', bg: 'bg-gray-50' };

  const upsert = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(payload);
      const r = await fetch('/api/admin/integrations/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: providerKey, payload: parsed }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || `HTTP ${r.status}`);
        return;
      }
      setOpen(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invalid JSON');
    } finally {
      setBusy(false);
    }
  }, [providerKey, payload]);

  const disconnect = useCallback(async () => {
    if (!confirm(`Disconnect ${providerLabel}? Existing sync jobs will fail until reconnected.`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/integrations/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: providerKey }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`Couldn't disconnect: ${data.error || r.status}`);
      } else {
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }, [providerKey, providerLabel]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-900/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-gray-900">{providerLabel}</div>
          <p className="mt-0.5 text-[12px] text-gray-500">{description}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full ${style.bg} px-2 py-1 text-[10.5px] font-medium ${style.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {status}
        </span>
      </div>

      {row?.display_label && (
        <div className="mt-2 text-[12px] text-gray-600">{row.display_label}</div>
      )}
      {row?.last_error && (
        <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">{row.last_error}</div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11.5px] font-medium text-slate-900 hover:underline"
        >
          {row ? 'Update credentials' : 'Connect'}
        </button>
        {row && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="text-[11.5px] text-gray-500 transition-colors hover:text-red-600 disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <h2 className="text-[16px] font-semibold text-gray-900">{providerLabel} credentials</h2>
            <p className="mt-1 text-[12px] text-gray-500">
              Paste the provider payload JSON. See docs for the expected shape per provider.
            </p>
            <textarea
              className="mt-3 block h-48 w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-[12px] text-gray-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              spellCheck={false}
            />
            {error && (
              <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">{error}</div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-2xl border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={upsert}
                disabled={busy}
                className="rounded-2xl bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
