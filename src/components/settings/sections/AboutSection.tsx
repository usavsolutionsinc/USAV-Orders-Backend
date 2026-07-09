'use client';

import { useEffect, useState } from 'react';
import pkg from '../../../../package.json';
import { Button, Panel, PanelFooter } from '@/design-system/primitives';
import { PRODUCT_NAME, PLATFORM_SUPPORT_EMAIL } from '@/lib/branding/constants';

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
        <h2 className="sr-only">About</h2>
        <p className="mt-1 text-sm text-text-muted">Build information for support and troubleshooting.</p>
      </header>

      {/* Migrated to the design-system <Panel> + <Button> primitives (P0-DS-01).
          Surface/border/radius now come from semantic tokens (theme-aware),
          replacing the hand-rolled `rounded-2xl border border-border-soft bg-surface-card`. */}
      <Panel padding="lg">
        <div className="mb-5">
          <div className="text-xl font-bold text-text-default">{PRODUCT_NAME}</div>
          <div className="text-sm text-text-muted">v{pkg.version}</div>
        </div>

        <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-[140px_1fr] sm:gap-x-4">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-xs font-medium text-text-muted">{r.label}</dt>
              <dd className="break-all font-mono text-xs text-text-default">{r.value}</dd>
            </div>
          ))}
        </dl>

        <PanelFooter>
          <Button type="button" size="sm" variant="primary" onClick={copyDiagnostics}>
            {copied ? 'Copied ✓' : 'Copy diagnostics'}
          </Button>
          <a
            href={`mailto:${PLATFORM_SUPPORT_EMAIL}?subject=${encodeURIComponent(`${PRODUCT_NAME} support`)}`}
            className="rounded-xl border border-border-soft bg-surface-card px-4 py-2 text-xs font-semibold text-text-default hover:bg-surface-canvas"
          >
            Contact support
          </a>
        </PanelFooter>
      </Panel>
    </div>
  );
}
