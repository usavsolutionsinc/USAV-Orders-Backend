'use client';

/**
 * Client island for /settings/staff.
 *
 * Renders the staff table, an invite modal, and inline role/active edits.
 * Optimistically mutates the local list and refetches from
 * /api/admin/staff/list after each mutation so we don't drift on errors.
 */

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface StaffRow {
  id: number;
  name: string;
  role: string;
  status: string;
  active: boolean;
  has_pin: boolean;
  last_login_at: string | null;
  default_home_path: string | null;
  color_hex: string;
  // WS6.1 per-staff auth policy.
  auth_method: string;               // 'pin' | 'password'
  requires_sensitive_stepup: boolean;
}

interface StaffTableProps {
  initialStaff: StaffRow[];
}

// Initial role for the invite modal. Editing existing staff happens in
// Settings → Access (staff_roles); this list seeds the first role on invite.
const ROLE_OPTIONS: ReadonlyArray<string> = [
  'admin', 'receiver', 'packer', 'technician', 'shipper',
  'inventory_manager', 'sales', 'viewer',
];

function fmtLogin(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function StaffTable({ initialStaff }: StaffTableProps) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState<number | 'invite' | null>(null);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async () => {
    const r = await fetch('/api/admin/staff/list', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setStaff(data.staff);
    }
  }, []);

  const deactivate = useCallback(async (id: number, name: string) => {
    if (!confirm(`Deactivate ${name}? Their active sessions will be revoked immediately.`)) return;
    setBusy(id);
    try {
      const r = await fetch('/api/admin/staff/deactivate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`Couldn't deactivate: ${data.error || r.status}`);
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  // WS6.1: persist a per-staff auth-policy change, then refetch. The update
  // route is itself behind the sensitive-info wall, so surface STEP_UP_REQUIRED.
  const updateAuthPolicy = useCallback(async (
    id: number,
    patch: { authMethod?: 'pin' | 'password'; requiresSensitiveStepUp?: boolean },
  ) => {
    setBusy(id);
    try {
      const r = await fetch('/api/admin/staff/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data.error === 'STEP_UP_REQUIRED') {
          alert('This change needs step-up verification. Re-authenticate (PIN/passkey) and try again.');
        } else {
          alert(`Couldn't update auth policy: ${data.error || r.status}`);
        }
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.role.toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q),
    );
  }, [staff, filter]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border-soft bg-surface-card p-3 shadow-sm">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, role, or status…"
          className="w-full max-w-xs rounded-xl border border-border-soft bg-surface-card px-3 py-1.5 text-[13px] focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
        />
        <Button variant="brand" onClick={() => setInviteOpen(true)}>
          Invite teammate
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-sm">
        <table className="min-w-full divide-y divide-border-hairline text-[13px]">
          <thead className="bg-surface-canvas text-left text-caption font-medium uppercase tracking-[0.08em] text-text-soft">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">PIN</th>
              <th className="px-4 py-2">Auth</th>
              <th className="px-4 py-2">Last login</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-hairline">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-text-faint">No teammates match.</td></tr>
            ) : filtered.map((s) => (
              <tr key={s.id} className={s.active ? 'text-text-default' : 'text-text-faint'}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color_hex }} />
                    <span className="font-medium">{s.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2">
                  {/* Role is derived from staff_roles[0]. To edit, jump to
                      the access detail page where the Roles card is the
                      authoritative editor. */}
                  <HoverTooltip label="Edit roles in Settings → Access" asChild>
                    <a
                      href={`/settings/access?staffId=${s.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-0.5 text-label font-medium text-text-muted hover:border-border-soft hover:bg-surface-hover hover:text-text-default"
                    >
                      {s.role}
                      <span className="text-text-faint">›</span>
                    </a>
                  </HoverTooltip>
                </td>
                <td className="px-4 py-2">
                  <StatusPill status={s.status} active={s.active} />
                </td>
                <td className="px-4 py-2 text-label text-text-soft">{s.has_pin ? 'Set' : '—'}</td>
                <td className="px-4 py-2">
                  <AuthPolicyCell row={s} disabled={busy === s.id} onChange={updateAuthPolicy} />
                </td>
                <td className="px-4 py-2 text-label text-text-soft">{fmtLogin(s.last_login_at)}</td>
                <td className="px-4 py-2 text-right">
                  {s.active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deactivate(s.id, s.name)}
                      disabled={busy === s.id}
                      className="text-text-soft hover:text-red-600"
                    >
                      Deactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvited={async () => {
            setInviteOpen(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function StatusPill({ status, active }: { status: string; active: boolean }) {
  const effective = active ? status : 'deactivated';
  const styles: Record<string, string> = {
    active:       'bg-emerald-50 text-emerald-700',
    invited:      'bg-amber-50 text-amber-700',
    deactivated:  'bg-surface-sunken text-text-soft',
  };
  const css = styles[effective] ?? 'bg-surface-canvas text-text-soft';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${css}`}>
      {effective}
    </span>
  );
}

// WS6.1 per-staff auth policy control: sign-in method (PIN vs password) plus the
// sensitive-information step-up wall. Both persist via /api/admin/staff/update.
function AuthPolicyCell({
  row,
  disabled,
  onChange,
}: {
  row: StaffRow;
  disabled: boolean;
  onChange: (id: number, patch: { authMethod?: 'pin' | 'password'; requiresSensitiveStepUp?: boolean }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <HoverTooltip label="Sign-in method for this teammate" asChild>
        <select
          value={row.auth_method === 'password' ? 'password' : 'pin'}
          disabled={disabled}
          onChange={(e) => onChange(row.id, { authMethod: e.target.value as 'pin' | 'password' })}
          className="rounded-lg border border-border-soft bg-surface-card px-2 py-1 text-label text-text-muted focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft disabled:opacity-50"
        >
          <option value="pin">PIN</option>
          <option value="password">Password</option>
        </select>
      </HoverTooltip>
      <HoverTooltip label="Require password step-up before sensitive screens" asChild>
        <label className="inline-flex items-center gap-1 text-label text-text-soft">
          <input
            type="checkbox"
            checked={row.requires_sensitive_stepup}
            disabled={disabled}
            onChange={(e) => onChange(row.id, { requiresSensitiveStepUp: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-border-default text-text-muted focus:ring-border-soft disabled:opacity-50"
          />
          Wall
        </label>
      </HoverTooltip>
    </div>
  );
}

interface InviteModalProps {
  onClose: () => void;
  onInvited: () => void;
}

function InviteModal({ onClose, onInvited }: InviteModalProps) {
  const [form, setForm] = useState({ name: '', role: 'packer', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollmentUrl, setEnrollmentUrl] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/staff/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || `HTTP ${r.status}`);
        return;
      }
      setEnrollmentUrl(data.enrollmentUrl);
    } finally {
      setBusy(false);
    }
  }, [form]);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center px-4">
      {/* ds-raw-button: full-bleed modal scrim/overlay dismiss target, not a DS Button */}
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl border border-border-soft bg-surface-card p-5 shadow-2xl">
        <h2 className="text-[16px] font-semibold text-text-default">Invite a teammate</h2>
        <p className="mt-1 text-label text-text-soft">
          They'll get a link to set their PIN. If you provide an email we send the invite automatically.
        </p>

        {enrollmentUrl ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-label text-emerald-700">Invite created.</div>
            <label className="block">
              <span className="mb-1 block text-caption font-medium uppercase tracking-[0.08em] text-text-soft">Enrollment link</span>
              <input
                readOnly
                value={enrollmentUrl}
                className="block w-full rounded-xl border border-border-soft bg-surface-canvas px-3 py-2 font-mono text-[11.5px] text-text-muted"
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <div className="flex justify-end">
              <Button variant="brand" size="sm" onClick={onInvited}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-caption font-medium uppercase tracking-[0.08em] text-text-soft">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Sam Rivera"
                className="block w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-[13px] focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption font-medium uppercase tracking-[0.08em] text-text-soft">Role</span>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="block w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-[13px] focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
              >
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption font-medium uppercase tracking-[0.08em] text-text-soft">Email (optional)</span>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="sam@acme.com"
                type="email"
                className="block w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-[13px] focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
              />
            </label>
            {error && (
              <div className="rounded-lg bg-red-50 px-2 py-1.5 text-caption font-medium text-red-700">{error}</div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="brand"
                size="sm"
                onClick={submit}
                disabled={busy || !form.name.trim()}
              >
                {busy ? 'Inviting…' : 'Send invite'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
