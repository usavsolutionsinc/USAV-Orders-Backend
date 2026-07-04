'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from '@/components/Icons';
import { PRODUCT_NAME } from '@/lib/branding/constants';

type DetectedOS = 'mac' | 'win' | 'unknown';
type DetectedArch = 'arm64' | 'x64' | 'unknown';

type ReleaseResponse =
  | {
      ok: true;
      version: string;
      releaseUrl: string;
      publishedAt?: string;
      installers: {
        macArm64?: string;
        macX64?: string;
        win?: string;
      };
    }
  | {
      ok: false;
      reason: string;
      version?: string;
      releaseUrl: string;
      message?: string;
    };

function detectPlatform(): { os: DetectedOS; arch: DetectedArch } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { os: 'unknown', arch: 'unknown' };
  }

  type NavUA = {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
  };
  const uaData = (navigator as Navigator & { userAgentData?: NavUA }).userAgentData;
  const ua = navigator.userAgent || '';
  const platform = uaData?.platform || navigator.platform || '';

  let os: DetectedOS = 'unknown';
  if (/mac/i.test(platform) || /Mac OS X|Macintosh/i.test(ua)) os = 'mac';
  else if (/win/i.test(platform) || /Windows/i.test(ua)) os = 'win';

  let arch: DetectedArch = 'unknown';
  if (os === 'mac') {
    // Apple Silicon Macs report as Intel via UA for compatibility — assume arm64
    // for any modern Mac (post-2020). The user can switch to Intel if needed.
    arch = 'arm64';
  } else if (/x64|x86_64|Win64|WOW64/i.test(ua)) {
    arch = 'x64';
  } else if (/arm64|aarch64/i.test(ua)) {
    arch = 'arm64';
  }

  return { os, arch };
}

export function DesktopAppDownload() {
  const [release, setRelease] = useState<ReleaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [{ os, arch }, setPlatform] = useState<{ os: DetectedOS; arch: DetectedArch }>({
    os: 'unknown',
    arch: 'unknown',
  });
  const [macArchPick, setMacArchPick] = useState<DetectedArch>('arm64');

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    if (arch === 'x64' || arch === 'arm64') setMacArchPick(arch);
  }, [arch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/desktop-app/release', { cache: 'no-store' })
      .then((r) => r.json() as Promise<ReleaseResponse>)
      .then((data) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) {
          setRelease({
            ok: false,
            reason: 'fetch_failed',
            releaseUrl: 'https://github.com/usavsolutionsinc/USAV-Orders-Backend/releases/latest',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const macUrl = useMemo(() => {
    if (!release?.ok) return undefined;
    return macArchPick === 'arm64' ? release.installers.macArm64 : release.installers.macX64;
  }, [release, macArchPick]);
  const winUrl = release?.ok ? release.installers.win : undefined;
  const releaseUrl = release?.releaseUrl;
  const hasBothMacArches =
    release?.ok &&
    !!release.installers.macArm64 &&
    !!release.installers.macX64 &&
    release.installers.macArm64 !== release.installers.macX64;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
      <div className="w-full rounded-3xl bg-surface-card/80 p-8 shadow-xl ring-1 ring-black/5 backdrop-blur-sm sm:p-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Download className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text-default sm:text-4xl">
            Install {PRODUCT_NAME} desktop app
          </h1>
          <p className="mt-3 max-w-xl text-sm text-text-muted sm:text-base">
            Get full access — silent label printing, ring scanner support, sidecar server, and
            offline-friendly workflows.
          </p>
          {release?.ok && release.version && (
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-text-faint">
              Version {release.version}
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : release?.ok ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <PlatformCard
              label="macOS"
              subLabel={
                macUrl
                  ? macArchPick === 'arm64'
                    ? 'Apple Silicon (.dmg)'
                    : 'Intel (.dmg)'
                  : 'Not available'
              }
              highlighted={os === 'mac'}
              icon={<AppleIcon />}
              href={macUrl}
              extra={
                hasBothMacArches ? (
                  <div className="mt-3 inline-flex rounded-lg bg-surface-sunken p-0.5 text-caption">
                    <ArchToggle
                      active={macArchPick === 'arm64'}
                      onClick={() => setMacArchPick('arm64')}
                      label="Apple Silicon"
                    />
                    <ArchToggle
                      active={macArchPick === 'x64'}
                      onClick={() => setMacArchPick('x64')}
                      label="Intel"
                    />
                  </div>
                ) : null
              }
            />
            <PlatformCard
              label="Windows"
              subLabel={winUrl ? 'Installer (.exe)' : 'Not available'}
              highlighted={os === 'win'}
              icon={<WindowsIcon />}
              href={winUrl}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Couldn’t load the latest installer.</p>
            <p className="mt-1 text-amber-800">
              {release?.reason === 'no_published_release' || release?.reason === 'github_404'
                ? 'No published release is available yet.'
                : 'We hit a snag reaching GitHub. Try again in a moment, or browse releases directly.'}
            </p>
            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-900 underline-offset-2 hover:underline"
              >
                Open releases on GitHub →
              </a>
            )}
          </div>
        )}

        {release?.ok && releaseUrl && (
          <div className="mt-6 text-center">
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-text-soft underline-offset-2 hover:text-text-muted hover:underline"
            >
              View release notes
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformCard({
  label,
  subLabel,
  href,
  highlighted,
  icon,
  extra,
}: {
  label: string;
  subLabel: string;
  href?: string;
  highlighted: boolean;
  icon: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const disabled = !href;
  const base =
    'group relative flex flex-col rounded-2xl border p-6 text-left transition-all';
  const ring = highlighted
    ? 'border-transparent bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-white/20'
    : 'border-border-soft bg-surface-card text-text-default hover:border-border-default hover:shadow-md';
  const hover = disabled
    ? 'cursor-not-allowed opacity-60'
    : highlighted
      ? 'hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 hover:shadow-xl hover:shadow-indigo-500/40 active:scale-[0.99]'
      : 'active:scale-[0.99]';

  const content = (
    <>
      <div className="flex items-center justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            highlighted ? 'bg-white/20 ring-1 ring-white/30' : 'bg-surface-sunken'
          }`}
        >
          {icon}
        </div>
        {highlighted && (
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-micro font-bold uppercase tracking-widest text-white ring-1 ring-white/30">
            Your device
          </span>
        )}
      </div>
      <div className="mt-4">
        <div className={`text-xl font-bold ${highlighted ? 'text-white' : 'text-text-default'}`}>
          {label}
        </div>
        <div className={`mt-0.5 text-xs ${highlighted ? 'text-white/80' : 'text-text-soft'}`}>
          {subLabel}
        </div>
      </div>
      <div
        className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold ${
          highlighted ? 'text-white' : 'text-indigo-600'
        }`}
      >
        <Download className="h-4 w-4" />
        {disabled ? 'Unavailable' : 'Download'}
        {!disabled && (
          <svg
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
      {extra}
    </>
  );

  if (disabled) {
    return <div className={`${base} ${ring} ${hover}`}>{content}</div>;
  }

  return (
    <a href={href} download className={`${base} ${ring} ${hover}`}>
      {content}
    </a>
  );
}

function ArchToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`ds-raw-button rounded-md px-2.5 py-1 font-semibold transition-colors ${
        active ? 'bg-surface-card text-text-default shadow-sm' : 'text-text-soft hover:text-text-muted'
      }`}
    >
      {label}
    </button>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.23-1.16 3.05-.85.96-2.22 1.7-3.34 1.6-.14-1.1.45-2.27 1.16-3.04.79-.86 2.18-1.55 3.34-1.61zm3.43 16.04c-.51 1.17-.76 1.69-1.41 2.73-.92 1.45-2.21 3.25-3.82 3.27-1.43.01-1.8-.92-3.74-.91-1.94.01-2.34.93-3.78.92-1.61-.02-2.83-1.65-3.75-3.1C.94 17.13.32 12.94 2.04 10.13c1.22-1.97 3.16-3.13 4.97-3.13 1.85 0 3.01 1 4.55 1 1.49 0 2.4-1 4.54-1 1.61 0 3.32.86 4.55 2.34-4 2.16-3.34 7.88.13 9.13z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M3 5.48 10.5 4.4v7.05H3V5.48zm0 13.04 7.5 1.08v-7.05H3v5.97zm8.4 1.2L21 21V12.45h-9.6v7.27zM11.4 4.13 21 3v8.45h-9.6V4.13z" />
    </svg>
  );
}
