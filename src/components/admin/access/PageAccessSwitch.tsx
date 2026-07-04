'use client';

/**
 * One row in the "Page access" card: page label + permission string,
 * theme-coloured switch, and a tag showing the access source.
 *
 *   Role          — granted by the staff's role (default state)
 *   Granted       — override-add (custom grant)
 *   Revoked       — override-remove (custom revoke)
 *   Role denies   — not in role + no override
 */

import { type StationTheme, stationThemeColors } from '@/utils/staff-colors';
import type { PermissionSource } from '@/lib/auth/permissions-shared';

interface PageAccessSwitchProps {
  label: string;
  permission: string;
  enabled: boolean;
  source: PermissionSource;
  theme: StationTheme;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
}

const SOURCE_PILL: Record<PermissionSource, { className: string; text: string }> = {
  role:          { className: 'bg-surface-sunken text-text-muted ring-border-soft',          text: 'Role' },
  granted:       { className: 'bg-emerald-100 text-emerald-800 ring-emerald-200', text: 'Granted' },
  revoked:       { className: 'bg-rose-100 text-rose-800 ring-rose-200',          text: 'Revoked' },
  'role-denies': { className: 'bg-surface-sunken text-text-soft ring-border-soft',          text: 'Role denies' },
};

export function PageAccessSwitch({ label, permission, enabled, source, theme, disabled, busy, onToggle }: PageAccessSwitchProps) {
  const sc = stationThemeColors[theme];
  const pill = SOURCE_PILL[source];
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 transition ${disabled ? 'opacity-60' : 'hover:bg-surface-canvas/60'}`}>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${enabled ? 'text-text-default' : 'text-text-soft'}`}>{label}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <code className="truncate text-micro font-mono text-text-soft">{permission}</code>
          <span className={`rounded-full px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider ring-1 ring-inset ${pill.className}`}>
            {pill.text}
          </span>
        </div>
      </div>
      {/* ds-raw-button */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${label}`}
        disabled={disabled || busy}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
          enabled ? sc.bg : 'bg-surface-strong'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-surface-card shadow transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </li>
  );
}
