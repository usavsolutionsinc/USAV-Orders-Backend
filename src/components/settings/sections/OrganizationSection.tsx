'use client';

/**
 * Settings → Organization. Org-wide preferences from OrgSettingsSchema:
 * timezone, locale, currency, auth policies, warranty term, branding.
 */

import { useCallback, useEffect, useState } from 'react';

interface OrgProfileResponse {
  timezone: string;
  currency: string;
  locale: string;
  emailFirstSignin: boolean;
  requirePasskeyForNewStaff: boolean;
  maxConcurrentSessions: number;
  warrantyDays: number;
  brand: {
    name?: string;
    logoUrl?: string;
    primaryColor?: string;
  };
}

const FIELD_CLS =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'Pacific/Honolulu',
  'UTC',
] as const;

export function OrganizationSection() {
  const [draft, setDraft] = useState<OrgProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/organization/profile', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setErr("Couldn't load organization settings.");
        return;
      }
      setDraft(await r.json() as OrgProfileResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const r = await fetch('/api/admin/organization/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || "Couldn't save."));
        return;
      }
      setOk('Saved.');
      await load();
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!draft) {
    return err
      ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      : null;
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-bold text-gray-900">Organization</h2>
        <p className="mt-1 text-sm text-gray-500">
          Workspace-wide defaults for time, money, sign-in policy, and warranty terms.
        </p>
      </header>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {ok && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{ok}</div>}

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Regional</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Timezone</span>
            <select
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              className={FIELD_CLS}
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              {!TIMEZONES.includes(draft.timezone as typeof TIMEZONES[number]) && (
                <option value={draft.timezone}>{draft.timezone}</option>
              )}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Currency</span>
            <input
              type="text"
              maxLength={3}
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
              className={FIELD_CLS}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Locale</span>
            <input
              type="text"
              value={draft.locale}
              onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
              className={FIELD_CLS}
              placeholder="en-US"
            />
          </label>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Sign-in policy</h3>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.emailFirstSignin}
            onChange={(e) => setDraft({ ...draft, emailFirstSignin: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">Email-first sign-in</span>
            <span className="block text-xs text-gray-500">Require email then PIN instead of tap-your-name on stations.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.requirePasskeyForNewStaff}
            onChange={(e) => setDraft({ ...draft, requirePasskeyForNewStaff: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">Passkey required for new staff</span>
            <span className="block text-xs text-gray-500">New invites must enroll a passkey — no PIN-only accounts.</span>
          </span>
        </label>
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-gray-700">Max concurrent sessions per staff</span>
          <input
            type="number"
            min={0}
            value={draft.maxConcurrentSessions}
            onChange={(e) => setDraft({ ...draft, maxConcurrentSessions: Number(e.target.value) || 0 })}
            className={FIELD_CLS}
          />
          <span className="mt-1 block text-xs text-gray-500">0 = unlimited</span>
        </label>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Warranty</h3>
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-gray-700">Warranty term (days)</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={draft.warrantyDays}
            onChange={(e) => setDraft({ ...draft, warrantyDays: Number(e.target.value) || 30 })}
            className={FIELD_CLS}
          />
        </label>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Branding</h3>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Display name</span>
          <input
            type="text"
            value={draft.brand.name ?? ''}
            onChange={(e) => setDraft({ ...draft, brand: { ...draft.brand, name: e.target.value } })}
            className={FIELD_CLS}
            placeholder="USAV"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Logo URL</span>
          <input
            type="url"
            value={draft.brand.logoUrl ?? ''}
            onChange={(e) => setDraft({ ...draft, brand: { ...draft.brand, logoUrl: e.target.value } })}
            className={FIELD_CLS}
            placeholder="https://…"
          />
        </label>
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-gray-700">Primary color</span>
          <input
            type="text"
            value={draft.brand.primaryColor ?? ''}
            onChange={(e) => setDraft({ ...draft, brand: { ...draft.brand, primaryColor: e.target.value } })}
            className={FIELD_CLS}
            placeholder="#2563EB"
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  );
}
