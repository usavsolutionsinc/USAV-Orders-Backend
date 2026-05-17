'use client';

import { useEffect, useState } from 'react';
import pkg from '../../../../package.json';

interface AppInfo {
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
}

export function AboutSection() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { appInfo?: AppInfo } }).electronAPI;
    if (api?.appInfo) setAppInfo(api.appInfo);
  }, []);

  const rows: { label: string; value: string }[] = [
    { label: 'Version', value: pkg.version },
    { label: 'Platform', value: appInfo ? `${appInfo.platform} (${appInfo.arch})` : 'web' },
    { label: 'Electron', value: appInfo?.electron ?? 'n/a (browser)' },
    { label: 'Chromium', value: appInfo?.chrome ?? navigator.userAgent.split(' ').find((p) => p.startsWith('Chrome/'))?.slice(7) ?? 'unknown' },
    { label: 'Node', value: appInfo?.node ?? 'n/a (browser)' },
    { label: 'User agent', value: navigator.userAgent },
  ];

  async function copyDiagnostics() {
    const text = rows.map((r) => `${r.label}: ${r.value}`).join('\n') +
      `\nLocal time: ${new Date().toISOString()}\nURL: ${location.href}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">About</h2>
        <p className="mt-1 text-sm text-gray-500">Build information for support and troubleshooting.</p>
      </header>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <div className="text-xl font-bold text-gray-900">USAV Orders</div>
          <div className="text-sm text-gray-500">v{pkg.version}</div>
        </div>

        <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-[140px_1fr] sm:gap-x-4">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-xs font-medium text-gray-500">{r.label}</dt>
              <dd className="break-all font-mono text-xs text-gray-800">{r.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-5">
          <button
            type="button"
            onClick={copyDiagnostics}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
          >
            {copied ? 'Copied ✓' : 'Copy diagnostics'}
          </button>
          <a
            href="mailto:support@usavsolutions.com?subject=USAV%20Orders%20support"
            className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
