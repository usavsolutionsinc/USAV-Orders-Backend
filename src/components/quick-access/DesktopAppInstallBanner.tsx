'use client';

import { useEffect, useState } from 'react';
import { Download } from '@/components/Icons';
import { isElectron } from '@/utils/isElectron';

const DEFAULT_DOWNLOAD_URL = '/desktop-app';

interface DesktopAppInstallBannerProps {
  onAction: () => void;
}

/**
 * Bright CTA shown just above the sign-in card when the user is viewing
 * the site in a browser (not inside the Electron shell). Encourages
 * installing the native desktop app for full access (silent printing,
 * sidecar server, ring scanner, etc.).
 *
 * Hidden when:
 *  - running inside Electron (`isElectron()` true), or
 *  - SSR (no window yet — avoids hydration mismatch).
 *
 * The download URL is overridable via `NEXT_PUBLIC_DESKTOP_APP_DOWNLOAD_URL`;
 * the default `/desktop-app` is a local landing-page route operators can
 * populate with installer links for macOS / Windows.
 */
export function DesktopAppInstallBanner({ onAction }: DesktopAppInstallBannerProps) {
  const [mounted, setMounted] = useState(false);
  const [inElectron, setInElectron] = useState(false);
  useEffect(() => {
    setMounted(true);
    setInElectron(isElectron());
  }, []);

  if (!mounted || inElectron) return null;

  const url = process.env.NEXT_PUBLIC_DESKTOP_APP_DOWNLOAD_URL || DEFAULT_DOWNLOAD_URL;

  const handleClick = () => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    onAction();
  };

  return (
    <div className="shrink-0 border-t border-gray-100 px-3 py-3">
      <button
        type="button"
        onClick={handleClick}
        className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-4 py-3 text-left text-white shadow-md shadow-indigo-500/30 ring-1 ring-white/20 transition-all hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 hover:shadow-lg hover:shadow-indigo-500/40 active:scale-[0.98]"
      >
        {/* Animated sheen */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />

        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
          <Download className="h-4 w-4" />
        </span>

        <div className="relative min-w-0 flex-1">
          <div className="text-[12px] font-black uppercase tracking-widest text-white/90">
            Install desktop app
          </div>
          <div className="truncate text-[11px] font-medium text-white/80">
            Get full access — silent print, scanners, more
          </div>
        </div>

        <svg
          aria-hidden
          className="relative h-4 w-4 shrink-0 text-white/90 transition-transform group-hover:translate-x-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

export default DesktopAppInstallBanner;
