'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_MOBILE_DISPLAY_CONFIG,
  MOBILE_NAV_TAB_IDS,
  sanitizeMobileDisplayConfig,
  type MobileNavTabId,
} from '@/lib/auth/mobile-display-config';

// ─── Mobile defaults card ───────────────────────────────────────────────
//
// Sets the role-level mobile UI defaults. Every staff with this role
// inherits these values unless they have a per-staff override (set from
// /admin?section=access). "Reset" clears the role's defaults; the
// resolver then falls back to the system defaults (bottom nav disabled).

const TAB_LABELS: Record<MobileNavTabId, string> = {
  home: 'Home',
  scan: 'Scan (centre)',
  receiving: 'Receiving',
  packing: 'Packing',
  picks: 'Picks',
  signout: 'Sign out',
};

interface RoleMobileDefaultsCardProps {
  roleLabel: string;
  roleColor: string;
  mobileDefaults: unknown;
  busy: boolean;
  onSave: (config: unknown) => void;
  onReset: () => void;
}

export function RoleMobileDefaultsCard({ roleLabel, roleColor, mobileDefaults, busy, onSave, onReset }: RoleMobileDefaultsCardProps) {
  const sanitized = useMemo(() => sanitizeMobileDisplayConfig(mobileDefaults), [mobileDefaults]);
  const hasDefaults = sanitized !== null;

  // Show whichever value the role currently has set; fall back to the
  // hard-coded system default when this role hasn't set anything.
  const currentEnabled = sanitized?.bottomNav?.enabled ?? DEFAULT_MOBILE_DISPLAY_CONFIG.bottomNav.enabled;
  const currentTabs: MobileNavTabId[] = sanitized?.bottomNav?.tabs
    ? [...sanitized.bottomNav.tabs]
    : [...DEFAULT_MOBILE_DISPLAY_CONFIG.bottomNav.tabs];

  const [draftEnabled, setDraftEnabled] = useState(currentEnabled);
  const [draftTabs, setDraftTabs] = useState<MobileNavTabId[]>(currentTabs);

  useEffect(() => {
    setDraftEnabled(currentEnabled);
    setDraftTabs(currentTabs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileDefaults]);

  const toggleTab = (id: MobileNavTabId) => {
    setDraftTabs((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const dirty =
    draftEnabled !== currentEnabled ||
    draftTabs.length !== currentTabs.length ||
    draftTabs.some((t, i) => t !== currentTabs[i]);

  const save = () => {
    onSave({
      bottomNav: {
        enabled: draftEnabled,
        tabs: draftTabs.length > 0 ? draftTabs : ['scan'],
      },
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Mobile defaults</h2>
          <p className="mt-0.5 text-caption text-gray-500">
            Every staff with the <b style={{ color: roleColor }}>{roleLabel}</b> role inherits these — unless overridden in <a href="/settings/access" className="text-blue-600 hover:underline">Access</a>.
          </p>
        </div>
        {hasDefaults && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Clear role defaults; staff fall back to system default"
          >
            Reset
          </button>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        <label className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Bottom navigation bar</div>
            <p className="mt-0.5 text-caption text-gray-500">
              When off, staff in this role are locked to a single page on their phone.
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

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="text-micro text-gray-500">
            {hasDefaults ? 'Role defaults active.' : 'No defaults set — using system default.'}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-caption font-semibold uppercase tracking-wider text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : dirty ? 'Save defaults' : 'Saved'}
          </button>
        </div>
      </div>
    </section>
  );
}
