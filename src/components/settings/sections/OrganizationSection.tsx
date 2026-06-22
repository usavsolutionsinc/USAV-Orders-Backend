'use client';

/**
 * Settings → Organization. Org-wide preferences from OrgSettingsSchema:
 * timezone, locale, currency, auth policies, warranty term, branding.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

function orgInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'W';
}

/**
 * "Which workspace am I in" card + deliberate org switcher. The active tenant is
 * fixed for the session and switching is infrequent — so this lives in Settings
 * rather than as an always-on header switcher (which would collide with the
 * master-nav dropdown and risk resetting per-page mode/unbox state).
 *
 * The switch list renders every membership from the auth envelope. Pre-identity-
 * migration that's always a single entry (the current org), so only the
 * read-only header shows. Once an account belongs to >1 org, the others become
 * switchable rows.
 */
function ActiveWorkspaceCard() {
  const { user } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchErr, setSwitchErr] = useState<string | null>(null);
  if (!user) return null;

  const memberships = user.memberships ?? [];
  const others = memberships.filter((m) => !m.isCurrent);

  const switchTo = async (organizationId: string, name: string) => {
    if (switching) return;
    if (!window.confirm(`Switch to ${name}? Your current view and any unsaved scan state will close.`)) return;
    setSwitching(organizationId);
    setSwitchErr(null);
    try {
      const r = await fetch('/api/auth/switch-org', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setSwitchErr(
          (data as { error?: string }).error === 'NOT_A_MEMBER'
            ? "You're not a member of that workspace."
            : "Couldn't switch workspace.",
        );
        setSwitching(null);
        return;
      }
      // Hard reload so caches / realtime subscriptions / RLS context reset
      // cleanly to the new tenant. NOT router.push.
      window.location.assign('/dashboard');
    } catch {
      setSwitchErr("Couldn't switch workspace.");
      setSwitching(null);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">Active workspace</h3>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-sm font-bold text-white">
          {orgInitials(user.organizationName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-gray-900">{user.organizationName}</div>
          <div className="truncate text-xs text-gray-500">
            {user.organizationSlug ?? '—'}
            {user.organizationPlan ? ` · ${user.organizationPlan} plan` : ''}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-eyebrow font-bold uppercase tracking-wide text-emerald-700">
          Current
        </span>
      </div>

      {switchErr && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{switchErr}</div>
      )}

      {others.length > 0 && (
        <div className="space-y-1 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">Switch workspace</p>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {others.map((m) => (
              <button
                key={m.organizationId}
                type="button"
                disabled={!!switching}
                onClick={() => void switchTo(m.organizationId, m.organizationName)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50 disabled:opacity-50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-xs font-bold text-gray-700">
                  {orgInitials(m.organizationName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">{m.organizationName}</div>
                  <div className="truncate text-xs text-gray-500">
                    {m.organizationSlug ?? '—'}
                    {m.role ? ` · ${m.role.replace(/_/g, ' ')}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-gray-400">
                  {switching === m.organizationId ? 'Switching…' : 'Switch →'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-500">
        You&rsquo;re signed in to this workspace. Every page, scan, and record you see is scoped to it.
      </p>
    </div>
  );
}

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

// Canonical built-in roles accepted by the invite API (mirrors ALL_ROLES in
// src/lib/auth/permissions-shared.ts — keep in sync). Custom org roles aren't
// invitable today because the backend validates against canonicalRole().
const INVITE_ROLES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'viewer', label: 'Viewer' },
  { key: 'receiver', label: 'Receiver' },
  { key: 'packer', label: 'Packer' },
  { key: 'technician', label: 'Technician' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'inventory_manager', label: 'Inventory Manager' },
  { key: 'sales', label: 'Sales' },
  { key: 'admin', label: 'Admin' },
];

interface PendingInvitation {
  id: string;
  email: string;
  roleKey: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Invite teammates by email + manage pending invitations. Admin-only
 * (admin.manage_staff). Accepting an invite creates the person's global account
 * + membership + staff profile (see docs/identity-layer-plan.md). The created
 * link is shown inline so it works even when transactional email is stubbed.
 */
function InvitationsSection() {
  const { has } = useAuth();
  const [list, setList] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const canManage = has('admin.manage_staff');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/org/invitations', { credentials: 'include', cache: 'no-store' });
      if (r.ok) {
        const data = await r.json() as { invitations: PendingInvitation[] };
        setList(data.invitations ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (canManage) void load(); }, [canManage, load]);

  const invite = useCallback(async () => {
    if (submitting || !email) return;
    setSubmitting(true);
    setErr(null);
    setLastUrl(null);
    setCopied(false);
    try {
      const r = await fetch('/api/org/invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr((data as { error?: string }).error === 'INVALID_INPUT'
          ? 'Enter a valid email address.'
          : "Couldn't create the invitation.");
        return;
      }
      setLastUrl((data as { inviteUrl?: string }).inviteUrl ?? null);
      setEmail('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }, [submitting, email, role, load]);

  const revoke = useCallback(async (id: string) => {
    if (revoking) return;
    setRevoking(id);
    try {
      const r = await fetch(`/api/org/invitations/${id}`, { method: 'DELETE', credentials: 'include' });
      if (r.ok) setList((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setRevoking(null);
    }
  }, [revoking]);

  const copy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, []);

  // Hidden entirely for non-admins.
  if (!canManage) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-sm font-semibold text-gray-900">Invite teammates</h3>
        <p className="mt-1 text-xs text-gray-500">
          Send an email invite to join this workspace. They&rsquo;ll set up their account and land in the app.
        </p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className={FIELD_CLS + ' flex-1'}
          onKeyDown={(e) => { if (e.key === 'Enter') void invite(); }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD_CLS + ' sm:w-44'}>
          {INVITE_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <button
          type="button"
          disabled={submitting || !email}
          onClick={() => void invite()}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {submitting ? 'Inviting…' : 'Invite'}
        </button>
      </div>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {lastUrl && (
        <div className="space-y-1 rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-xs font-medium text-emerald-800">Invitation created — share this link:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-emerald-200">{lastUrl}</code>
            <button
              type="button"
              onClick={() => void copy(lastUrl)}
              className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-500">Pending invitations</p>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-gray-400">No pending invitations.</p>
        ) : (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {list.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">{inv.email}</div>
                  <div className="truncate text-xs text-gray-500">
                    {(inv.roleKey ?? 'viewer').replace(/_/g, ' ')}
                    {' · expires '}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={revoking === inv.id}
                  onClick={() => void revoke(inv.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {revoking === inv.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

      <ActiveWorkspaceCard />

      <InvitationsSection />

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
