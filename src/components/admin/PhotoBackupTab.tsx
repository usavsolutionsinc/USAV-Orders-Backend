'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface BackupStatus {
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  photosUploaded: number;
  photosPending: number;
}

interface AlbumResult {
  key: string;
  title: string;
  productUrl?: string;
  count: number;
}

interface BackupSummary {
  date: string;
  scanned: number;
  uploaded: number;
  skipped: number;
  failed: number;
  albums: AlbumResult[];
  errors: Array<{ photoId: number; message: string }>;
}

function yesterdayStr(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function PhotoBackupTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justConnected = searchParams.get('gp_connected') === '1';
  const oauthError = searchParams.get('gp_error');

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [date, setDate] = useState<string>(yesterdayStr());
  const [limit, setLimit] = useState<number>(50);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/admin/google-photos/status', { credentials: 'include' });
      if (!res.ok) throw new Error(`Status fetch failed (${res.status})`);
      const data = (await res.json()) as BackupStatus;
      setStatus(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (justConnected || oauthError) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('gp_connected');
      params.delete('gp_error');
      router.replace(`/admin?${params.toString()}`);
    }
  }, [justConnected, oauthError, router, searchParams]);

  const handleConnect = () => {
    window.location.href = '/api/admin/google-photos/connect';
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Photos? Future backups will require re-authorizing.')) return;
    setErrorMessage(null);
    const res = await fetch('/api/admin/google-photos/disconnect', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      setErrorMessage(`Disconnect failed (${res.status})`);
      return;
    }
    await loadStatus();
  };

  const handleRunBackup = async () => {
    setRunning(true);
    setSummary(null);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/google-photos/backup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, limit }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Backup failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as BackupSummary;
      setSummary(data);
      await loadStatus();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Photo Backup</h1>
          <p className="text-sm text-slate-600">
            Mirror photos stored in Vercel Blob into Google Photos albums grouped by day and station.
            Only photos uploaded on the selected day that have not already been backed up are processed.
          </p>
        </header>

        {oauthError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Google sign-in error: {oauthError}
          </div>
        )}
        {justConnected && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Google Photos connected.
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connection</h2>
          {loadingStatus ? (
            <p className="mt-3 text-sm text-slate-500">Loading…</p>
          ) : status?.connected ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-700">
                Connected as <span className="font-medium">{status.accountEmail ?? 'unknown account'}</span>
                {status.connectedAt && (
                  <span className="text-slate-400"> · since {new Date(status.connectedAt).toLocaleString()}</span>
                )}
              </p>
              <button
                type="button"
                onClick={handleDisconnect}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600">
                Google Photos is not connected. Click below to sign in with the Google account that should own
                the backup albums.
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

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Totals</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="text-3xl font-semibold text-slate-900">{status?.photosUploaded ?? '—'}</div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Backed up</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-amber-600">{status?.photosPending ?? '—'}</div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Pending backup</div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Run daily backup</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col text-sm text-slate-700">
              <span className="mb-1 font-medium">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col text-sm text-slate-700">
              <span className="mb-1 font-medium">Batch limit</span>
              <input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value) || 50)))}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleRunBackup}
                disabled={!status?.connected || running}
                className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {running ? 'Backing up…' : 'Back up to Google Photos'}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Photos are uploaded in batches of {limit}. If the day has more pending photos, click again.
          </p>
        </section>

        {errorMessage && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorMessage}
          </div>
        )}

        {summary && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Last run — {summary.date}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-slate-500">Scanned</dt>
                <dd className="text-xl font-semibold text-slate-900">{summary.scanned}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Uploaded</dt>
                <dd className="text-xl font-semibold text-emerald-600">{summary.uploaded}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Skipped</dt>
                <dd className="text-xl font-semibold text-slate-600">{summary.skipped}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Failed</dt>
                <dd className="text-xl font-semibold text-rose-600">{summary.failed}</dd>
              </div>
            </dl>

            {summary.albums.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Albums</h3>
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {summary.albums.map((album) => (
                    <li key={album.key} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{album.title}</div>
                        <div className="text-xs text-slate-500">{album.count} photos uploaded</div>
                      </div>
                      {album.productUrl && (
                        <a
                          href={album.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-sky-600 hover:text-sky-700"
                        >
                          View in Google Photos →
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary.errors.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-600">
                  Errors ({summary.errors.length})
                </h3>
                <ul className="space-y-1 text-xs text-rose-800">
                  {summary.errors.slice(0, 10).map((e) => (
                    <li key={e.photoId}>
                      <span className="font-mono">photo #{e.photoId}</span>: {e.message}
                    </li>
                  ))}
                  {summary.errors.length > 10 && (
                    <li className="text-rose-500">…and {summary.errors.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
