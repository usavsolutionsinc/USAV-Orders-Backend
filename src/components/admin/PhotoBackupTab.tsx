'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Camera, Check, X, Loader2, RefreshCw } from '@/components/Icons';

interface BackupStatus {
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  photosUploaded: number;
  photosPending: number;
  oldestPendingDate: string | null;
  needsReconnect: boolean;
  needsReconnectReason: string | null;
}

interface BackupSettings {
  autoDeleteEnabled: boolean;
  autoDeleteAfterDays: number;
  lastCronRunAt: string | null;
}

interface RunRow {
  id: number;
  source: 'manual' | 'manual_stream' | 'cron';
  date: string | null;
  startedAt: string;
  endedAt: string | null;
  scanned: number;
  uploaded: number;
  failed: number;
  blobDeleted: number;
  hasErrors: boolean;
}

interface PendingDate {
  date: string;
  count: number;
  receivingCount: number;
  packingCount: number;
}

interface PhotoEvent {
  photoId: number;
  index: number;
  total: number;
  station: string;
  ok: boolean;
  filename?: string;
  albumTitle: string;
  albumUrl?: string;
  error?: string;
}

interface ActiveRun {
  date: string;
  total: number;
  index: number;
  uploaded: number;
  failed: number;
  rows: PhotoEvent[];
  aborted: boolean;
  done: boolean;
}

const LIMIT_STORAGE_KEY = 'usav.photoBackup.limit';

function readSavedLimit(): number {
  if (typeof window === 'undefined') return 50;
  const raw = window.localStorage.getItem(LIMIT_STORAGE_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(200, n) : 50;
}

export function PhotoBackupTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justConnected = searchParams.get('gp_connected') === '1';
  const oauthError = searchParams.get('gp_error');

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [pending, setPending] = useState<PendingDate[]>([]);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [history, setHistory] = useState<RunRow[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [limit, setLimit] = useState<number>(50);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const isStreaming = run !== null && !run.done;

  // Restore saved batch limit on mount.
  useEffect(() => {
    setLimit(readSavedLimit());
  }, []);
  // Persist on change.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LIMIT_STORAGE_KEY, String(limit));
    }
  }, [limit]);

  const liveStatusText = useMemo(() => {
    if (run && !run.done) return `Backing up ${run.date} — ${run.index} of ${run.total}…`;
    if (run && run.done) {
      return `Backup ${run.aborted ? 'cancelled' : 'complete'}. Uploaded ${run.uploaded} of ${run.total} photos for ${run.date}.`;
    }
    return '';
  }, [run]);

  const loadAll = useCallback(async () => {
    try {
      const [statusRes, pendingRes, settingsRes, runsRes] = await Promise.all([
        fetch('/api/admin/google-photos/status', { credentials: 'include' }),
        fetch('/api/admin/google-photos/pending', { credentials: 'include' }),
        fetch('/api/admin/google-photos/settings', { credentials: 'include' }),
        fetch('/api/admin/google-photos/runs', { credentials: 'include' }),
      ]);
      if (!statusRes.ok) throw new Error(`Status fetch failed (${statusRes.status})`);
      if (!pendingRes.ok) throw new Error(`Pending fetch failed (${pendingRes.status})`);
      const statusData = (await statusRes.json()) as BackupStatus;
      const pendingData = (await pendingRes.json()) as { pending: PendingDate[] };
      setStatus(statusData);
      setPending(pendingData.pending);
      if (settingsRes.ok) {
        const s = (await settingsRes.json()) as BackupSettings;
        setSettings(s);
      }
      if (runsRes.ok) {
        const r = (await runsRes.json()) as { runs: RunRow[] };
        setHistory(r.runs);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  const saveSettings = async (next: BackupSettings) => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/google-photos/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setSettings(next);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const runManualCleanup = async () => {
    if (!settings) return;
    if (!confirm(`Delete Vercel Blob copies of photos backed up more than ${settings.autoDeleteAfterDays} days ago? This cannot be undone.`)) return;
    setRunningCleanup(true);
    try {
      const res = await fetch('/api/admin/google-photos/cleanup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afterDays: settings.autoDeleteAfterDays }),
      });
      if (!res.ok) throw new Error(`Cleanup failed (${res.status})`);
      const data = (await res.json()) as { deleted: number; failed: number; scanned: number };
      if (data.deleted === 0 && data.failed === 0) {
        toast.info('No blobs eligible for cleanup yet');
      } else if (data.failed === 0) {
        toast.success(`Deleted ${data.deleted} ${data.deleted === 1 ? 'blob' : 'blobs'}`);
      } else {
        toast.warning(`${data.deleted} deleted, ${data.failed} failed`);
      }
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningCleanup(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (justConnected) toast.success('Google Photos connected');
    if (oauthError) toast.error(`Google sign-in error: ${oauthError}`);
    if (justConnected || oauthError) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('gp_connected');
      params.delete('gp_error');
      router.replace(`/admin?${params.toString()}`);
    }
  }, [justConnected, oauthError, router, searchParams]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const startStream = useCallback(
    (date: string, opts?: { ids?: number[] }) => {
      eventSourceRef.current?.close();
      setRun({
        date,
        total: 0,
        index: 0,
        uploaded: 0,
        failed: 0,
        rows: [],
        aborted: false,
        done: false,
      });

      const url = new URL('/api/admin/google-photos/backup-stream', window.location.origin);
      url.searchParams.set('date', date);
      url.searchParams.set('limit', String(limit));
      if (opts?.ids?.length) url.searchParams.set('ids', opts.ids.join(','));

      const es = new EventSource(url.toString(), { withCredentials: true });
      eventSourceRef.current = es;

      es.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data);
          if (ev.type === 'start') {
            setRun((prev) => (prev ? { ...prev, total: ev.total } : prev));
            if (ev.total === 0) {
              toast.info(`No photos to back up for ${date}`);
            }
          } else if (ev.type === 'progress') {
            setRun((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                index: ev.index,
                uploaded: prev.uploaded + (ev.ok ? 1 : 0),
                failed: prev.failed + (ev.ok ? 0 : 1),
                rows: [
                  ...prev.rows,
                  {
                    photoId: ev.photoId,
                    index: ev.index,
                    total: ev.total,
                    station: ev.station,
                    ok: ev.ok,
                    filename: ev.filename,
                    albumTitle: ev.albumTitle,
                    albumUrl: ev.albumUrl,
                    error: ev.error,
                  },
                ],
              };
            });
          } else if (ev.type === 'done') {
            setRun((prev) => (prev ? { ...prev, done: true, aborted: !!ev.aborted } : prev));
            es.close();
            eventSourceRef.current = null;
            if (ev.aborted) {
              toast.info(`Cancelled after ${ev.uploaded} uploaded`);
            } else if (ev.failed === 0 && ev.uploaded > 0) {
              toast.success(`Uploaded ${ev.uploaded} ${ev.uploaded === 1 ? 'photo' : 'photos'} for ${date}`);
            } else if (ev.uploaded === 0 && ev.failed > 0) {
              toast.error(`All ${ev.failed} uploads failed for ${date}`);
            } else if (ev.uploaded > 0 && ev.failed > 0) {
              toast.warning(`${ev.uploaded} uploaded, ${ev.failed} failed for ${date}`);
            }
            void loadAll();
          } else if (ev.type === 'error') {
            toast.error(ev.message);
            setRun((prev) => (prev ? { ...prev, done: true } : prev));
            es.close();
            eventSourceRef.current = null;
          }
        } catch {
          // ignore malformed message
        }
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setRun((prev) => (prev ? { ...prev, done: true } : prev));
          eventSourceRef.current = null;
        }
      };
    },
    [limit, loadAll],
  );

  const cancelStream = () => {
    if (!eventSourceRef.current) return;
    eventSourceRef.current.close();
    eventSourceRef.current = null;
    setRun((prev) => (prev ? { ...prev, done: true, aborted: true } : prev));
    toast.info('Backup cancelled');
    void loadAll();
  };

  const retryFailed = () => {
    if (!run || !run.done) return;
    const failedIds = run.rows.filter((r) => !r.ok).map((r) => r.photoId);
    if (failedIds.length === 0) return;
    startStream(run.date, { ids: failedIds });
  };

  const handleConnect = () => {
    window.location.href = '/api/admin/google-photos/connect';
  };

  const handleDisconnect = async () => {
    setConfirmingDisconnect(false);
    const res = await fetch('/api/admin/google-photos/disconnect', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      toast.error(`Disconnect failed (${res.status})`);
      return;
    }
    toast.success('Google Photos disconnected');
    await loadAll();
  };

  const allCaughtUp = status?.connected && status.photosPending === 0 && !isStreaming;

  return (
    <div className="h-full overflow-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Photo Backup</h1>
          <p className="text-sm text-slate-600">
            Mirror photos stored in Vercel Blob into Google Photos albums grouped by day and station.
          </p>
        </header>

        {/* Reconnect banner — yellow, highest priority */}
        {status?.needsReconnect && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-medium">Google Photos needs reconnecting.</div>
            <div className="text-xs text-amber-800">
              {status.needsReconnectReason
                ? status.needsReconnectReason
                : 'The refresh token was rejected. Backups will fail until you sign in again.'}
            </div>
            <button
              type="button"
              onClick={handleConnect}
              className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Reconnect Google Photos
            </button>
          </div>
        )}

        {/* Connection */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connection</h2>
          {loadingInitial ? (
            <div className="mt-3"><SkeletonCard className="h-16" /></div>
          ) : status?.connected ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-700">
                Connected as <span className="font-medium">{status.accountEmail ?? 'unknown account'}</span>
                {status.connectedAt && (
                  <span className="text-slate-400"> · since {new Date(status.connectedAt).toLocaleString()}</span>
                )}
              </p>
              {!status.accountEmail && (
                <p className="text-xs text-amber-700">
                  Tip: reconnect to capture your Google account email.
                </p>
              )}
              {confirmingDisconnect ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700">Disconnect Google Photos?</span>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
                  >
                    Yes, disconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDisconnect(false)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(true)}
                  disabled={isStreaming}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600">
                Google Photos is not connected. Click below to sign in with the Google account that should own the backup albums.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Connect Google Photos
              </button>
            </div>
          )}
        </section>

        {/* Totals */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Totals</h2>
          {loadingInitial ? (
            <div className="mt-3 grid grid-cols-2 gap-4">
              <SkeletonCard className="h-16" />
              <SkeletonCard className="h-16" />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="text-3xl font-semibold text-slate-900">{status?.photosUploaded ?? 0}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Backed up</div>
              </div>
              <div>
                <div className={`text-3xl font-semibold ${(status?.photosPending ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {status?.photosPending ?? 0}
                </div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Pending backup</div>
              </div>
            </div>
          )}
        </section>

        {/* Live progress card — only while streaming or just-finished */}
        {run && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!run.done && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {run.done
                    ? `Run complete — ${run.date}`
                    : `Backing up ${run.date}`}
                </h2>
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={cancelStream}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              ) : run.failed > 0 ? (
                <button
                  type="button"
                  onClick={retryFailed}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry {run.failed} failed
                </button>
              ) : null}
            </div>

            <ProgressBar
              current={run.index}
              goal={Math.max(run.total, 1)}
              label={`${run.index} of ${run.total} processed`}
              showPercentage
              showRemaining={false}
              variant={run.done && run.failed === 0 ? 'success' : 'default'}
            />

            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase text-slate-500">Uploaded</div>
                <div className="text-xl font-semibold text-emerald-600">{run.uploaded}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Failed</div>
                <div className="text-xl font-semibold text-rose-600">{run.failed}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Total</div>
                <div className="text-xl font-semibold text-slate-900">{run.total}</div>
              </div>
            </div>

            {run.rows.length > 0 && (
              <div className="mt-5 max-h-72 overflow-y-auto rounded-md border border-slate-200">
                <ul className="divide-y divide-slate-100">
                  {run.rows.map((r) => (
                    <li key={`${r.index}-${r.photoId}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                      {r.ok ? (
                        <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                      ) : (
                        <X className="h-4 w-4 flex-shrink-0 text-rose-500" />
                      )}
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {r.station}
                      </span>
                      <span className="font-mono text-xs text-slate-500">#{r.photoId}</span>
                      <span className="truncate text-slate-700">
                        {r.ok ? (r.filename ?? 'Uploaded') : (r.error ?? 'Failed')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {run.done && run.uploaded > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {Array.from(new Set(run.rows.filter((r) => r.ok && r.albumUrl).map((r) => `${r.albumTitle}|${r.albumUrl}`))).map((kv) => {
                  const [title, url] = kv.split('|');
                  return (
                    <a
                      key={kv}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
                    >
                      {title} →
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Pending queue OR all-caught-up */}
        {!loadingInitial && allCaughtUp && !run ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <EmptyState
              icon={<Camera className="h-8 w-8 text-emerald-500" />}
              title="All caught up"
              description="Every photo has been mirrored to Google Photos. New photos uploaded going forward will appear here as Pending."
            />
          </section>
        ) : !loadingInitial && pending.length > 0 ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Pending queue ({pending.length} {pending.length === 1 ? 'day' : 'days'})
              </h2>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Batch limit
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={limit}
                  disabled={isStreaming}
                  onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value) || 50)))}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                />
              </label>
            </div>
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {pending.map((row) => (
                <li key={row.date} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">{row.date}</div>
                    <div className="text-xs text-slate-500">
                      {row.count} {row.count === 1 ? 'photo' : 'photos'}
                      {row.receivingCount > 0 && ` · ${row.receivingCount} receiving`}
                      {row.packingCount > 0 && ` · ${row.packingCount} packing`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startStream(row.date)}
                    disabled={!status?.connected || isStreaming}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Back up {row.count > limit ? `${limit} of ${row.count}` : 'day'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Settings — auto-delete from Vercel Blob */}
        {!loadingInitial && settings && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Auto-delete from Vercel Blob</h2>
            <p className="mt-2 text-sm text-slate-600">
              After photos are confirmed backed up to Google Photos, automatically delete the originals from Vercel Blob to free space.
              The Google Photos copy stays; only the blob URL is removed.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.autoDeleteEnabled}
                  disabled={savingSettings || runningCleanup}
                  onChange={(e) =>
                    setSettings((prev) => (prev ? { ...prev, autoDeleteEnabled: e.target.checked } : prev))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Enable auto-delete
              </label>
              <label className="flex flex-col text-sm text-slate-700">
                <span className="mb-1 font-medium">Delete after</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={settings.autoDeleteAfterDays}
                    disabled={savingSettings || runningCleanup}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev
                          ? { ...prev, autoDeleteAfterDays: Math.min(365, Math.max(1, Number(e.target.value) || 30)) }
                          : prev,
                      )
                    }
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                  />
                  <span className="text-xs text-slate-500">days after upload</span>
                </div>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => settings && saveSettings(settings)}
                  disabled={savingSettings}
                  className="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:bg-slate-300"
                >
                  {savingSettings ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {settings.lastCronRunAt ? (
                <span>
                  Last cron run:{' '}
                  <span className="font-medium text-slate-700">{new Date(settings.lastCronRunAt).toLocaleString()}</span>
                </span>
              ) : (
                <span>Cron has not run yet.</span>
              )}
              <button
                type="button"
                onClick={runManualCleanup}
                disabled={runningCleanup || isStreaming}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {runningCleanup ? 'Cleaning up…' : 'Run cleanup now'}
              </button>
            </div>
          </section>
        )}

        {/* Run history */}
        {!loadingInitial && history.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent runs</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 text-right font-medium">Uploaded</th>
                    <th className="py-2 pr-4 text-right font-medium">Failed</th>
                    <th className="py-2 pr-4 text-right font-medium">Blobs deleted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.slice(0, 10).map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 pr-4 text-slate-700">{new Date(row.startedAt).toLocaleString()}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            row.source === 'cron'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {row.source === 'cron' ? 'cron' : 'manual'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{row.date ?? '—'}</td>
                      <td className="py-2 pr-4 text-right font-medium text-emerald-600">{row.uploaded}</td>
                      <td className="py-2 pr-4 text-right font-medium text-rose-600">{row.failed || ''}</td>
                      <td className="py-2 pr-4 text-right text-slate-600">{row.blobDeleted || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Aria-live region for screen readers */}
        <div aria-live="polite" className="sr-only">
          {liveStatusText}
        </div>
      </div>
    </div>
  );
}
