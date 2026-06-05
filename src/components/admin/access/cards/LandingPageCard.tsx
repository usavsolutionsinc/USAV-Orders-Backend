'use client';

/**
 * Where this staff lands right after signing in. Two independent dropdowns
 * (desktop + mobile); NULL means "fall back to ROLE_HOME[role]". The
 * authoritative resolver lives in /signin/page.tsx; the defaults below are
 * only the placeholder hints.
 */

import { APP_SIDEBAR_NAV } from '@/lib/sidebar-navigation';

// Mirrors the pages that exist under src/app/m/ — keep in sync.
const MOBILE_LANDING_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '/m/home',      label: 'Home (hub)' },
  { value: '/m/scan',      label: 'Scan' },
  { value: '/m/receive',   label: 'Receive (door scan)' },
  { value: '/m/receiving', label: 'Receiving' },
  { value: '/m/pick',      label: 'Pick' },
];

const DESKTOP_ROLE_DEFAULTS: Record<string, string> = {
  admin: '/dashboard', receiver: '/receiving', receiving: '/receiving',
  packer: '/packer', technician: '/tech', shipper: '/dashboard',
  inventory_manager: '/inventory', sales: '/dashboard',
  viewer: '/dashboard', readonly: '/dashboard',
};
const MOBILE_ROLE_DEFAULTS: Record<string, string> = {
  receiver: '/m/receiving', receiving: '/m/receiving', packer: '/m/pick',
};

interface LandingPageCardProps {
  borderClass: string;
  permissions: ReadonlySet<string>;
  desktopPath: string | null;
  mobilePath: string | null;
  primaryRoleKey: string | null;
  busy: boolean;
  onSave: (patch: { defaultHomePath?: string | null; defaultHomePathMobile?: string | null }) => void;
}

export function LandingPageCard({
  borderClass, permissions, desktopPath, mobilePath, primaryRoleKey, busy, onSave,
}: LandingPageCardProps) {
  // Desktop options = sidebar pages the staff can actually open, in sidebar order.
  const desktopOptions = APP_SIDEBAR_NAV
    .filter((item) => !item.requires || permissions.has(item.requires))
    .map((item) => ({ value: item.href, label: item.label }));

  // If a saved override points somewhere not in the filtered list (e.g. the
  // permission was just removed), keep it as a "legacy" option so the admin
  // sees what's stored. Build on local copies — never mutate the const arrays.
  const desktopList = desktopPath && !desktopOptions.some((o) => o.value === desktopPath)
    ? [...desktopOptions, { value: desktopPath, label: `${desktopPath} (legacy)` }]
    : desktopOptions;
  const mobileList = mobilePath && !MOBILE_LANDING_OPTIONS.some((o) => o.value === mobilePath)
    ? [...MOBILE_LANDING_OPTIONS, { value: mobilePath, label: `${mobilePath} (legacy)` }]
    : MOBILE_LANDING_OPTIONS;

  const desktopDefault = primaryRoleKey ? DESKTOP_ROLE_DEFAULTS[primaryRoleKey.toLowerCase()] ?? '/dashboard' : '/dashboard';
  const mobileDefault = primaryRoleKey ? MOBILE_ROLE_DEFAULTS[primaryRoleKey.toLowerCase()] ?? '/m/home' : '/m/home';

  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-white shadow-sm`}>
      <header className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Landing page</h2>
        <p className="mt-0.5 text-caption text-gray-500">
          Where this staff lands right after signing in. Desktop and mobile are independent —
          leave either on <i>“Use role default”</i> to fall back to the role&apos;s built-in destination.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
        {/* Desktop */}
        <label className="flex flex-col gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Desktop</span>
          <select
            value={desktopPath ?? ''}
            onChange={(e) => onSave({ defaultHomePath: e.target.value === '' ? null : e.target.value })}
            disabled={busy}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60"
          >
            <option value="">Use role default ({desktopDefault})</option>
            {desktopList.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.value}</option>
            ))}
          </select>
          <span className="text-micro text-gray-400">
            {desktopPath ? <>Override active: <span className="font-mono text-gray-600">{desktopPath}</span></> : <>Inheriting <span className="font-mono">{desktopDefault}</span></>}
          </span>
        </label>

        {/* Mobile */}
        <label className="flex flex-col gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Mobile</span>
          <select
            value={mobilePath ?? ''}
            onChange={(e) => onSave({ defaultHomePathMobile: e.target.value === '' ? null : e.target.value })}
            disabled={busy}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60"
          >
            <option value="">Use role default ({mobileDefault})</option>
            {mobileList.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.value}</option>
            ))}
          </select>
          <span className="text-micro text-gray-400">
            {mobilePath ? <>Override active: <span className="font-mono text-gray-600">{mobilePath}</span></> : <>Inheriting <span className="font-mono">{mobileDefault}</span></>}
          </span>
        </label>
      </div>
    </section>
  );
}
