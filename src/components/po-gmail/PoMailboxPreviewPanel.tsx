'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Search, X } from '@/components/Icons';

type Mode = 'missing' | 'scanned' | 'raw';

interface MatchRow {
  zoho_purchaseorder_number: string | null;
  zoho_purchaseorder_id: string | null;
  workflow_status: string;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number | null;
  receiving_id: number | null;
}

interface ReconcileItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  internalDate: string;
  snippet: string;
  hasAttachments: boolean;
  bodyPreview: string;
  bodyTruncated: boolean;
  bodyLength: number;
  extracted: { all: string[]; labeled: string[]; unlabeled: string[] };
  matches: MatchRow[];
  matchedPoNumbers: string[];
  status: 'missing' | 'in_zoho' | 'received' | 'no_match';
}

interface ReconcileResponse {
  query: string;
  limit: number;
  counts: { missing: number; in_zoho: number; received: number; no_match: number };
  persisted: { upserted: number; resolved: number } | null;
  elapsedMs: number;
  items: ReconcileItem[];
}

interface MissingRow {
  id: string;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  po_numbers: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  status: 'pending' | 'ignored' | 'resolved';
  notes: string | null;
  resolved_at: string | null;
}

interface MissingResponse {
  items: MissingRow[];
  counts: { pending: number; ignored: number; resolved: number };
}

// Legacy "raw preview" response (the original dry-run endpoint).
interface PreviewItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  internalDate: string;
  snippet: string;
  hasAttachments: boolean;
  bodyPreview: string;
  bodyTruncated: boolean;
  bodyLength: number;
  extracted: { all: string[]; labeled: string[]; unlabeled: string[] };
}
interface PreviewResponse { query: string; limit: number; count: number; elapsedMs: number; items: PreviewItem[]; }

const MODE_TABS: { id: Mode; label: string }[] = [
  { id: 'missing', label: 'Missing from Zoho' },
  { id: 'scanned', label: 'All scanned' },
  { id: 'raw',     label: 'Raw preview' },
];

const MISSING_STATUS_TABS: { id: 'pending' | 'ignored' | 'resolved'; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'resolved', label: 'Resolved' },
];

export function PoMailboxPreviewPanel({
  title = 'PO email reconciler',
  description = 'Scan unread emails, diff against Zoho POs (via receiving_lines), and track missing ones.',
  embedded = false,
}: { title?: string | null; description?: string | null; embedded?: boolean }) {
  const [mode, setMode] = useState<Mode>('missing');

  /* ── shared scan controls (used by 'scanned' + 'raw') ───────────────── */
  const [scanQuery, setScanQuery] = useState('is:unread');
  const [scanLimit, setScanLimit] = useState(25);
  const [scanLoading, setScanLoading] = useState(false);

  /* ── scanned mode state ─────────────────────────────────────────────── */
  const [reconcile, setReconcile] = useState<ReconcileResponse | null>(null);

  /* ── raw mode state ─────────────────────────────────────────────────── */
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  /* ── missing mode state ─────────────────────────────────────────────── */
  const [missing, setMissing] = useState<MissingResponse | null>(null);
  const [missingStatusFilter, setMissingStatusFilter] = useState<'pending' | 'ignored' | 'resolved'>('pending');
  const [missingLoading, setMissingLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  /* ── row expand toggle (shared) ─────────────────────────────────────── */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const runReconcile = useCallback(async () => {
    setScanLoading(true);
    try {
      const url = new URL('/api/admin/po-gmail/reconcile', window.location.origin);
      url.searchParams.set('q', scanQuery);
      url.searchParams.set('limit', String(scanLimit));
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as ReconcileResponse;
      setReconcile(data);
      setExpanded({});
      const summary = `missing ${data.counts.missing} · in Zoho ${data.counts.in_zoho} · received ${data.counts.received}`;
      toast.success(`Reconciled ${data.items.length} in ${data.elapsedMs}ms — ${summary}`);
      // missing tab depends on this run for freshness
      if (mode === 'missing') void fetchMissing();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setScanLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanQuery, scanLimit, mode]);

  const runRawPreview = useCallback(async () => {
    setScanLoading(true);
    try {
      const url = new URL('/api/admin/po-gmail/preview-unread', window.location.origin);
      url.searchParams.set('q', scanQuery);
      url.searchParams.set('limit', String(scanLimit));
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      setExpanded({});
      toast.success(`Scanned ${data.count} in ${data.elapsedMs}ms`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setScanLoading(false);
    }
  }, [scanQuery, scanLimit]);

  const fetchMissing = useCallback(async () => {
    setMissingLoading(true);
    try {
      const url = new URL('/api/admin/po-gmail/missing-orders', window.location.origin);
      url.searchParams.set('status', missingStatusFilter);
      url.searchParams.set('limit', '100');
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      setMissing((await res.json()) as MissingResponse);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load missing failed');
    } finally {
      setMissingLoading(false);
    }
  }, [missingStatusFilter]);

  // Initial load + refresh when filter / mode changes.
  useEffect(() => {
    if (mode === 'missing') void fetchMissing();
  }, [mode, fetchMissing]);

  const updateMissingStatus = useCallback(
    async (id: string, status: 'pending' | 'ignored' | 'resolved') => {
      setActingId(id);
      try {
        const res = await fetch('/api/admin/po-gmail/missing-orders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status }),
        });
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        toast.success(`Marked ${status}`);
        await fetchMissing();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
      } finally {
        setActingId(null);
      }
    },
    [fetchMissing],
  );

  return (
    <section className={embedded ? 'space-y-2.5' : 'space-y-4'}>
      {!embedded && (title || description) && (
        <div>
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {description && <p className="mt-0.5 text-label text-gray-500">{description}</p>}
        </div>
      )}

      {/* Mode toggle — small inline pill row */}
      <div className={`${embedded ? 'flex w-full' : 'inline-flex'} rounded-md border border-gray-200 bg-white p-0.5 ${embedded ? 'text-caption' : 'text-label'} font-medium`}>
        {MODE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={`${embedded ? 'flex-1' : ''} rounded-[5px] ${embedded ? 'px-2 py-1' : 'px-3 py-1.5'} transition-colors ${
              mode === t.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {embedded ? t.label.replace('Missing from ', '').replace('All scanned', 'Scanned').replace('Raw preview', 'Raw') : t.label}
          </button>
        ))}
      </div>

      {mode === 'missing' && (
        <MissingMode
          missing={missing}
          loading={missingLoading}
          statusFilter={missingStatusFilter}
          onStatusFilter={setMissingStatusFilter}
          onRefresh={fetchMissing}
          onAct={updateMissingStatus}
          actingId={actingId}
          onRunReconcile={runReconcile}
          scanQuery={scanQuery}
          setScanQuery={setScanQuery}
          scanLimit={scanLimit}
          setScanLimit={setScanLimit}
          scanLoading={scanLoading}
        />
      )}

      {mode === 'scanned' && (
        <ScannedMode
          response={reconcile}
          loading={scanLoading}
          query={scanQuery}
          setQuery={setScanQuery}
          limit={scanLimit}
          setLimit={setScanLimit}
          onRun={runReconcile}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      )}

      {mode === 'raw' && (
        <RawMode
          response={preview}
          loading={scanLoading}
          query={scanQuery}
          setQuery={setScanQuery}
          limit={scanLimit}
          setLimit={setScanLimit}
          onRun={runRawPreview}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      )}
    </section>
  );
}

/* ─────────────────────────── Missing mode ─────────────────────────────── */

function MissingMode(props: {
  missing: MissingResponse | null;
  loading: boolean;
  statusFilter: 'pending' | 'ignored' | 'resolved';
  onStatusFilter: (s: 'pending' | 'ignored' | 'resolved') => void;
  onRefresh: () => void;
  onAct: (id: string, status: 'pending' | 'ignored' | 'resolved') => void;
  actingId: string | null;
  onRunReconcile: () => void;
  scanQuery: string;
  setScanQuery: (s: string) => void;
  scanLimit: number;
  setScanLimit: (n: number) => void;
  scanLoading: boolean;
}) {
  const { missing, loading, statusFilter, onStatusFilter, onRefresh, onAct, actingId,
          onRunReconcile, scanQuery, setScanQuery, scanLimit, setScanLimit, scanLoading } = props;

  return (
    <div className="space-y-3">
      {/* Scan controls — run a fresh reconcile to populate the worklist */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <label className="flex-1 min-w-[220px]">
          <span className="block text-caption font-medium text-gray-700">Gmail query</span>
          <input
            type="text"
            value={scanQuery}
            onChange={(e) => setScanQuery(e.target.value)}
            placeholder="is:unread"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label>
          <span className="block text-caption font-medium text-gray-700">Limit</span>
          <input
            type="number"
            min={1}
            max={50}
            value={scanLimit}
            onChange={(e) => setScanLimit(Math.min(50, Math.max(1, Number(e.target.value) || 25)))}
            className="mt-1 w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <button
          type="button"
          onClick={onRunReconcile}
          disabled={scanLoading}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Scan + reconcile
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-label text-gray-500 underline hover:text-gray-900 disabled:opacity-50"
        >
          Refresh list
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap items-center gap-2 text-label">
        {MISSING_STATUS_TABS.map((t) => {
          const n = missing?.counts[t.id] ?? 0;
          const active = statusFilter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onStatusFilter(t.id)}
              className={`rounded-full border px-2.5 py-1 transition-colors ${
                active
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 tabular-nums ${active ? 'opacity-90' : 'opacity-70'}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading && !missing ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : !missing || missing.items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          {statusFilter === 'pending'
            ? 'Nothing missing — every scanned email matched a PO in Zoho.'
            : `No ${statusFilter} rows.`}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
          {missing.items.map((row) => {
            const acting = actingId === row.id;
            return (
              <li key={row.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {row.email_subject || '(no subject)'}
                      </span>
                      <span className="truncate text-label text-gray-500">{row.email_from}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                      <span>{new Date(row.scanned_at).toLocaleString()}</span>
                      <span aria-hidden>·</span>
                      <StatusChip status={row.status} />
                      {row.po_numbers.map((p) => (
                        <span key={p} className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-700">
                          {p}
                        </span>
                      ))}
                    </div>
                    {row.notes && (
                      <p className="mt-1 text-[11.5px] italic text-gray-500">{row.notes}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {row.gmail_msg_id && (
                      <a
                        href={`https://mail.google.com/mail/u/0/#all/${row.gmail_msg_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-gray-200 px-2 py-1 text-[11.5px] text-gray-600 hover:bg-gray-50"
                      >
                        Open ↗
                      </a>
                    )}
                    {row.status !== 'ignored' && (
                      <button
                        type="button"
                        onClick={() => onAct(row.id, 'ignored')}
                        disabled={acting}
                        className="rounded-md border border-gray-200 px-2 py-1 text-[11.5px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Ignore
                      </button>
                    )}
                    {row.status === 'ignored' && (
                      <button
                        type="button"
                        onClick={() => onAct(row.id, 'pending')}
                        disabled={acting}
                        className="rounded-md border border-gray-200 px-2 py-1 text-[11.5px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────── Scanned mode ─────────────────────────────── */

function ScannedMode(props: {
  response: ReconcileResponse | null;
  loading: boolean;
  query: string; setQuery: (s: string) => void;
  limit: number; setLimit: (n: number) => void;
  onRun: () => void;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const { response, loading, query, setQuery, limit, setLimit, onRun, expanded, setExpanded } = props;
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <ScanControls query={query} setQuery={setQuery} limit={limit} setLimit={setLimit} onRun={onRun} loading={loading} actionLabel="Reconcile" />

      {response && (
        <div className="space-y-2">
          <SummaryRow
            elapsedMs={response.elapsedMs}
            counts={response.counts}
            extra={response.persisted ? `· wrote ${response.persisted.upserted}, resolved ${response.persisted.resolved}` : ''}
          />
          {response.items.length === 0 ? (
            <p className="text-sm text-gray-500">No messages matched.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {response.items.map((item) => {
                const isOpen = !!expanded[item.id];
                return (
                  <li key={item.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        className="mt-0.5 shrink-0 rounded-md p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="truncate text-sm font-medium text-gray-900">{item.subject || '(no subject)'}</span>
                          <span className="truncate text-label text-gray-500">{item.from}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                          <span>{item.date || new Date(Number(item.internalDate)).toLocaleString()}</span>
                          <span aria-hidden>·</span>
                          <ReconcileStatusChip status={item.status} />
                          {item.extracted.all.length === 0 ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">no PO# extracted</span>
                          ) : (
                            item.extracted.all.map((n) => {
                              const matched = item.matchedPoNumbers.some(
                                (p) => p.replace(/[^A-Z0-9]/gi, '').toUpperCase() === n.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
                              );
                              return (
                                <span
                                  key={n}
                                  className={`rounded px-1.5 py-0.5 font-mono ${
                                    matched ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {n}
                                </span>
                              );
                            })
                          )}
                        </div>
                        {isOpen && (
                          <div className="mt-2 space-y-2">
                            {item.matches.length > 0 && (
                              <table className="w-full border-collapse text-[11.5px]">
                                <thead className="bg-gray-50 text-gray-500">
                                  <tr>
                                    <th className="px-2 py-1 text-left font-medium">PO#</th>
                                    <th className="px-2 py-1 text-left font-medium">Status</th>
                                    <th className="px-2 py-1 text-left font-medium">SKU / Item</th>
                                    <th className="px-2 py-1 text-right font-medium">Qty exp</th>
                                    <th className="px-2 py-1 text-right font-medium">Qty recv</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.matches.map((m, i) => (
                                    <tr key={`${m.zoho_purchaseorder_id}-${i}`} className="border-t border-gray-100">
                                      <td className="px-2 py-1 font-mono">{m.zoho_purchaseorder_number ?? '—'}</td>
                                      <td className="px-2 py-1">{m.workflow_status}</td>
                                      <td className="px-2 py-1 truncate">{m.sku ?? m.item_name ?? '—'}</td>
                                      <td className="px-2 py-1 text-right">{m.quantity_expected ?? '—'}</td>
                                      <td className="px-2 py-1 text-right">{m.quantity_received ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11.5px] text-gray-700">
                              {item.bodyPreview || '(empty body)'}
                              {item.bodyTruncated && (
                                <span className="block pt-2 text-gray-400">
                                  … truncated at 800 chars (full body is {item.bodyLength} chars)
                                </span>
                              )}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Raw mode ───────────────────────────────── */

function RawMode(props: {
  response: PreviewResponse | null;
  loading: boolean;
  query: string; setQuery: (s: string) => void;
  limit: number; setLimit: (n: number) => void;
  onRun: () => void;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const { response, loading, query, setQuery, limit, setLimit, onRun, expanded, setExpanded } = props;
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <ScanControls query={query} setQuery={setQuery} limit={limit} setLimit={setLimit} onRun={onRun} loading={loading} actionLabel="Scan" />

      {response && (
        <div className="space-y-2">
          <div className="text-label text-gray-500">
            {response.count} messages · {response.elapsedMs}ms · regex extraction only
          </div>
          {response.items.length === 0 ? (
            <p className="text-sm text-gray-500">No messages matched.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {response.items.map((item) => {
                const isOpen = !!expanded[item.id];
                return (
                  <li key={item.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        className="mt-0.5 shrink-0 rounded-md p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="truncate text-sm font-medium text-gray-900">{item.subject || '(no subject)'}</span>
                          <span className="truncate text-label text-gray-500">{item.from}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                          <span>{item.date || new Date(Number(item.internalDate)).toLocaleString()}</span>
                          {item.extracted.all.length === 0 ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">no PO# detected</span>
                          ) : (
                            item.extracted.all.map((n) => (
                              <span
                                key={n}
                                className={`rounded px-1.5 py-0.5 font-mono ${
                                  item.extracted.labeled.includes(n) ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'
                                }`}
                              >
                                {n}
                              </span>
                            ))
                          )}
                        </div>
                        {isOpen && (
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11.5px] text-gray-700">
                            {item.bodyPreview || '(empty body)'}
                            {item.bodyTruncated && (
                              <span className="block pt-2 text-gray-400">
                                … truncated at 800 chars (full body is {item.bodyLength} chars)
                              </span>
                            )}
                          </pre>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Shared bits ──────────────────────────────── */

function ScanControls(props: {
  query: string; setQuery: (s: string) => void;
  limit: number; setLimit: (n: number) => void;
  onRun: () => void; loading: boolean;
  actionLabel: string;
}) {
  const { query, setQuery, limit, setLimit, onRun, loading, actionLabel } = props;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-[220px]">
        <span className="block text-caption font-medium text-gray-700">Gmail query</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="is:unread"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label>
        <span className="block text-caption font-medium text-gray-700">Limit</span>
        <input
          type="number"
          min={1}
          max={50}
          value={limit}
          onChange={(e) => setLimit(Math.min(50, Math.max(1, Number(e.target.value) || 25)))}
          className="mt-1 w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <button
        type="button"
        onClick={onRun}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {actionLabel}
      </button>
    </div>
  );
}

function SummaryRow({ elapsedMs, counts, extra }: {
  elapsedMs: number; counts: { missing: number; in_zoho: number; received: number; no_match: number }; extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-label text-gray-500">
      <span><span className="font-semibold text-amber-700">{counts.missing}</span> missing</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-blue-700">{counts.in_zoho}</span> in Zoho</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-emerald-700">{counts.received}</span> received</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-gray-500">{counts.no_match}</span> unmatched</span>
      <span aria-hidden>·</span>
      <span>{elapsedMs}ms</span>
      {extra && <span className="text-gray-400">{extra}</span>}
    </div>
  );
}

function StatusChip({ status }: { status: 'pending' | 'ignored' | 'resolved' }) {
  const cls =
    status === 'pending'
      ? 'bg-amber-50 text-amber-700'
      : status === 'ignored'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-emerald-50 text-emerald-700';
  const Icon = status === 'pending' ? AlertTriangle : status === 'ignored' ? X : Check;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

function ReconcileStatusChip({ status }: { status: ReconcileItem['status'] }) {
  const map: Record<ReconcileItem['status'], { cls: string; label: string }> = {
    missing:  { cls: 'bg-amber-50 text-amber-700',     label: 'missing' },
    in_zoho:  { cls: 'bg-blue-50 text-blue-700',       label: 'in Zoho' },
    received: { cls: 'bg-emerald-50 text-emerald-700', label: 'received' },
    no_match: { cls: 'bg-gray-100 text-gray-600',      label: 'no PO#' },
  };
  const m = map[status];
  return <span className={`rounded px-1.5 py-0.5 ${m.cls}`}>{m.label}</span>;
}
