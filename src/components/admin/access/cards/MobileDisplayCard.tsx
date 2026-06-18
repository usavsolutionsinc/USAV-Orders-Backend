'use client';

/**
 * Lets an admin override the mobile UI for one staff: (1) bottom-nav enabled
 * toggle, (2) which tabs render. Always shows the *effective* state (role
 * default + override). "Reset to role default" clears the override so the
 * resolver falls back to roles.mobile_defaults (editable in /admin?section=roles).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MOBILE_NAV_TAB_IDS,
  resolveMobileDisplayConfig,
  sanitizeMobileDisplayConfig,
  type MobileDisplayConfig,
  type MobileNavTabId,
} from '@/lib/auth/mobile-display-config';
import type { RoleSlim } from '../staff-access-shared';

interface MobileDisplayCardProps {
  borderClass: string;
  rolesForResolve: ReadonlyArray<RoleSlim>;
  staffOverride: unknown;
  busy: boolean;
  onSave: (config: unknown) => void;
  onReset: () => void;
}

const TAB_LABELS: Record<MobileNavTabId, string> = {
  home: 'Recent',
  scan: 'Scan (centre)',
  receiving: 'Receiving',
  packing: 'Packing',
  picks: 'Picks',
  signout: 'Sign out',
};

export function MobileDisplayCard({
  borderClass, rolesForResolve, staffOverride, busy, onSave, onReset,
}: MobileDisplayCardProps) {
  const initialOverride = useMemo(
    () => sanitizeMobileDisplayConfig(staffOverride),
    [staffOverride],
  );

  const resolved: MobileDisplayConfig = useMemo(
    () => resolveMobileDisplayConfig({
      roles: rolesForResolve.map((r) => ({ key: r.key, mobile_defaults: r.mobile_defaults })),
      staffOverride,
    }),
    [rolesForResolve, staffOverride],
  );

  const hasOverride = initialOverride !== null;
  const [draftEnabled, setDraftEnabled] = useState<boolean>(resolved.bottomNav.enabled);
  const [draftTabs, setDraftTabs] = useState<MobileNavTabId[]>([...resolved.bottomNav.tabs]);

  // Resync the draft when the underlying staff/role data changes (e.g. after a save).
  useEffect(() => {
    setDraftEnabled(resolved.bottomNav.enabled);
    setDraftTabs([...resolved.bottomNav.tabs]);
  }, [resolved]);

  const toggleTab = (id: MobileNavTabId) => {
    setDraftTabs((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const dirty =
    draftEnabled !== resolved.bottomNav.enabled ||
    draftTabs.length !== resolved.bottomNav.tabs.length ||
    draftTabs.some((t, i) => t !== resolved.bottomNav.tabs[i]);

  const save = () => {
    onSave({
      bottomNav: {
        enabled: draftEnabled,
        tabs: draftTabs.length > 0 ? draftTabs : ['scan'],
      },
    });
  };

  const primaryRoleLabel = rolesForResolve[0]?.label ?? '—';

  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-white shadow-sm`}>
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Mobile display</h2>
          <p className="mt-0.5 text-caption text-gray-500">
            Controls what this staff sees on their phone. Defaults inherit from <b>{primaryRoleLabel}</b>.
            Edit role defaults in <a href="/settings/roles" className="text-blue-600 hover:underline">Roles</a>.
          </p>
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Clear per-staff override; fall back to role default"
          >
            Reset to role
          </button>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        {/* Bottom nav enabled */}
        <label className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Bottom navigation bar</div>
            <p className="mt-0.5 text-caption text-gray-500">
              When off, the phone is locked to a single page — no tabs to wander into other sections.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draftEnabled}
            onClick={() => setDraftEnabled((v) => !v)}
            disabled={busy}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              draftEnabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                draftEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        {/* Tabs */}
        <div>
          <div className="text-sm font-semibold text-gray-900">Tabs</div>
          <p className="mb-2 mt-0.5 text-caption text-gray-500">
            Tap to toggle. Scan stays centre and raised when included.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOBILE_NAV_TAB_IDS.map((id) => {
              const on = draftTabs.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTab(id)}
                  disabled={busy || !draftEnabled}
                  className={`rounded-full px-2.5 py-1 text-caption font-semibold ring-1 ring-inset transition ${
                    on
                      ? 'bg-blue-100 text-blue-800 ring-blue-300'
                      : 'bg-gray-50 text-gray-500 ring-gray-200 hover:bg-gray-100'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {TAB_LABELS[id]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save row */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="text-micro text-gray-500">
            {hasOverride ? 'Per-staff override active.' : 'Inheriting role default.'}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-caption font-semibold uppercase tracking-wider text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : dirty ? 'Save override' : 'Saved'}
          </button>
        </div>
      </div>
    </section>
  );
}
