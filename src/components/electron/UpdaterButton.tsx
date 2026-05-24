'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertTriangle, RotateCcw, Info } from 'lucide-react';

type UpdaterEvent =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'progress'
  | 'downloaded'
  | 'error';

type UpdaterApi = {
  check: () => Promise<{ ok: boolean; reason?: string; version?: string | null }>;
  install: () => Promise<{ ok: boolean; reason?: string }>;
  on: (event: UpdaterEvent, cb: (payload: unknown) => void) => () => void;
};

type ElectronAPI = {
  isElectron?: boolean;
  updater?: UpdaterApi;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version?: string }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string };

/**
 * Normalize raw electron-updater error messages into something a non-engineer
 * can read. Anything we don't have a friendly mapping for falls through to
 * the raw message (truncated) so engineers still get signal without the
 * user staring at an unlabeled red icon.
 */
function classifyFailure(reason: string | undefined): Status {
  const raw = (reason || '').trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === 'unavailable') {
    // Only reachable on a legacy Electron build now — dev mode actually
    // runs the updater against GitHub. Treat as informational, not an error.
    return { kind: 'info', message: 'Updates not available on this build' };
  }
  if (
    lower.includes('enoent') ||
    lower.includes('latest-mac.yml') ||
    lower.includes('latest.yml') ||
    lower.includes('no published versions')
  ) {
    return { kind: 'info', message: 'No release published yet' };
  }
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('network') || lower.includes('offline')) {
    return { kind: 'error', message: 'No internet — try again later' };
  }
  if (lower.includes('404')) {
    return { kind: 'info', message: 'No release published yet' };
  }
  if (lower.includes('signature') || lower.includes('not signed')) {
    return { kind: 'error', message: 'Update signature check failed' };
  }
  // Unknown — keep the gist, drop stack traces, cap length
  const short = raw.split('\n')[0].slice(0, 80);
  return { kind: 'error', message: short || 'Update check failed' };
}

/**
 * Compact "Check for updates" button — sized to slot into the Quick access
 * popover header in place of the close X. Only renders inside the Electron
 * shell; returns null in a browser tab.
 *
 * States cycle through idle → checking → (downloading X% | up-to-date | error)
 * → ready (when an update is fully downloaded). Clicking in the `ready`
 * state triggers quitAndInstall via IPC.
 */
export function UpdaterButton({ className = '' }: { className?: string }) {
  const [api, setApi] = useState<UpdaterApi | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const autoResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const electron = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
    if (!electron?.isElectron || !electron.updater) return;
    setApi(electron.updater);
  }, []);

  const scheduleReset = useCallback((ms: number) => {
    if (autoResetTimer.current) clearTimeout(autoResetTimer.current);
    autoResetTimer.current = setTimeout(() => setStatus({ kind: 'idle' }), ms);
  }, []);

  useEffect(() => {
    if (!api) return;
    const offs: Array<() => void> = [];

    offs.push(api.on('checking', () => setStatus({ kind: 'checking' })));
    offs.push(api.on('available', () => setStatus({ kind: 'downloading', percent: 0 })));
    offs.push(api.on('not-available', () => {
      setStatus({ kind: 'up-to-date' });
      scheduleReset(4000);
    }));
    offs.push(api.on('progress', (payload) => {
      const p = payload as { percent?: number } | null;
      const percent = Math.max(0, Math.min(100, Math.round(p?.percent ?? 0)));
      setStatus({ kind: 'downloading', percent });
    }));
    offs.push(api.on('downloaded', (payload) => {
      const info = payload as { version?: string } | null;
      setStatus({ kind: 'ready', version: info?.version });
    }));
    offs.push(api.on('error', (payload) => {
      const err = payload as { message?: string } | null;
      // Log the full message for engineers; surface a friendly summary in UI
      console.warn('[updater] event error:', err?.message);
      setStatus(classifyFailure(err?.message));
      scheduleReset(6000);
    }));

    return () => {
      offs.forEach((off) => off());
      if (autoResetTimer.current) clearTimeout(autoResetTimer.current);
    };
  }, [api, scheduleReset]);

  const handleClick = useCallback(async () => {
    if (!api) return;
    if (status.kind === 'ready') {
      await api.install();
      return;
    }
    if (status.kind === 'checking' || status.kind === 'downloading') return;
    setStatus({ kind: 'checking' });
    const res = await api.check();
    if (!res.ok) {
      console.warn('[updater] check failed:', res.reason);
      setStatus(classifyFailure(res.reason));
      scheduleReset(5000);
    }
  }, [api, status.kind, scheduleReset]);

  if (!api) return null;

  const view = renderView(status);

  return (
    <button
      type="button"
      onClick={handleClick}
      title={view.tooltip}
      aria-label={view.tooltip}
      disabled={status.kind === 'checking' || status.kind === 'downloading'}
      className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-caption font-semibold transition-colors disabled:cursor-default ${view.classes} ${className}`.trim()}
    >
      {view.icon}
      {view.badge && <span className="tabular-nums">{view.badge}</span>}
    </button>
  );
}

function renderView(status: Status): {
  icon: React.ReactNode;
  badge: string | null;
  tooltip: string;
  classes: string;
} {
  const iconProps = { size: 13, strokeWidth: 2.25 } as const;
  switch (status.kind) {
    case 'idle':
      return {
        icon: <Download {...iconProps} />,
        badge: null,
        tooltip: 'Check for updates',
        classes: 'text-gray-400 hover:bg-gray-100 hover:text-gray-700',
      };
    case 'checking':
      return {
        icon: <RefreshCw {...iconProps} className="animate-spin" />,
        badge: null,
        tooltip: 'Checking for updates…',
        classes: 'text-gray-500',
      };
    case 'downloading':
      return {
        icon: <RefreshCw {...iconProps} className="animate-spin" />,
        badge: `${status.percent}%`,
        tooltip: `Downloading update… ${status.percent}%`,
        classes: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
      };
    case 'up-to-date':
      return {
        icon: <CheckCircle2 {...iconProps} />,
        badge: 'Up to date',
        tooltip: 'You’re on the latest version',
        classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
      };
    case 'ready':
      return {
        icon: <RotateCcw {...iconProps} />,
        badge: status.version ? `Restart · ${status.version}` : 'Restart',
        tooltip: 'Click to restart and apply the update',
        classes: 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 hover:bg-amber-200',
      };
    case 'info':
      return {
        icon: <Info {...iconProps} />,
        badge: status.message,
        tooltip: status.message,
        classes: 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200',
      };
    case 'error':
      return {
        icon: <AlertTriangle {...iconProps} />,
        badge: status.message,
        tooltip: status.message,
        classes: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
      };
  }
}

export default UpdaterButton;
