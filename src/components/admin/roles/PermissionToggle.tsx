'use client';

/**
 * One permission row in the role editor. Mirrors PageAccessSwitch but
 * generic over the source label (this one shows "on/off" only — the role
 * editor is the source of truth, so there's no Role/Granted/Revoked
 * distinction).
 */

import { requiresStepUp, type PermissionString } from '@/lib/auth/permissions-shared';

interface PermissionToggleProps {
  label: string;
  permission: PermissionString;
  enabled: boolean;
  /** Hex color used for the on-state of the toggle. */
  color: string;
  disabled?: boolean;
  onToggle: () => void;
}

export function PermissionToggle({ label, permission, enabled, color, disabled, onToggle }: PermissionToggleProps) {
  const stepUp = requiresStepUp(permission);
  return (
    <li className={`flex items-center gap-3 px-4 py-2 transition ${disabled ? 'opacity-60' : 'hover:bg-gray-50/60'}`}>
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-1.5 truncate text-sm font-semibold ${enabled ? 'text-gray-900' : 'text-gray-500'}`}>
          <span className="truncate">{label}</span>
          {stepUp && (
            <span title="Requires step-up (fresh PIN) before this action" className="rounded-full bg-amber-100 px-1 py-0 text-eyebrow font-bold uppercase tracking-wider text-amber-900 ring-1 ring-amber-200">
              ⚡
            </span>
          )}
        </div>
        <code className="truncate text-micro font-mono text-gray-500">{permission}</code>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${label}`}
        disabled={disabled}
        onClick={onToggle}
        style={enabled ? { backgroundColor: color } : undefined}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${enabled ? '' : 'bg-gray-300'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </li>
  );
}
