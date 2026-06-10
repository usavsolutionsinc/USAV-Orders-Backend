'use client';

/**
 * Client island for /settings/staff.
 *
 * Renders the staff table, an invite modal, and inline role/active edits.
 * Optimistically mutates the local list and refetches from
 * /api/admin/staff/list after each mutation so we don't drift on errors.
 */

import { useCallback, useMemo, useState } from 'react';

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
}

interface StaffTableProps {
  initialStaff: StaffRow[];
}

// Initial role for the invite modal. Editing existing staff happens in
// Admin → Access (which writes to staff_roles); this list is only used to
// seed the very first role on a newly invited staffer.
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, role, or status…"
          className="w-full max-w-xs rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[13px] focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-slate-800"
        >
          Invite teammate
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 text-[13px]">
          <thead className="bg-gray-50 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">PIN</th>
              <th className="px-4 py-2">Last login</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No teammates match.</td></tr>
            ) : filtered.map((s) => (
              <tr key={s.id} className={s.active ? 'text-gray-900' : 'text-gray-400'}>
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
                  <a
                    href={`/admin?section=access&staffId=${s.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-0.5 text-[12px] font-medium text-gray-700 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900"
                    title="Edit roles in Admin → Access"
                  >
                    {s.role}
                    <span className="text-gray-400">›</span>
                  </a>
                </td>
                <td className="px-4 py-2">
                  <StatusPill status={s.status} active={s.active} />
                </td>
                <td className="px-4 py-2 text-[12px] text-gray-500">{s.has_pin ? 'Set' : '—'}</td>
                <td className="px-4 py-2 text-[12px] text-gray-500">{fmtLogin(s.last_login_at)}</td>
                <td className="px-4 py-2 text-right">
                  {s.active && (
                    <button
                      type="button"
                      onClick={() => deactivate(s.id, s.name)}
                      disabled={busy === s.id}
                      className="text-[12px] text-gray-500 transition-colors hover:text-red-600 disabled:opacity-50"
                    >
                      Deactivate
                    </button>
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
    deactivated:  'bg-gray-100 text-gray-500',
  };
  const css = styles[effective] ?? 'bg-gray-50 text-gray-500';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${css}`}>
      {effective}
    </span>
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
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <h2 className="text-[16px] font-semibold text-gray-900">Invite a teammate</h2>
        <p className="mt-1 text-[12px] text-gray-500">
          They'll get a link to set their PIN. If you provide an email we send the invite automatically.
        </p>

        {enrollmentUrl ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">Invite created.</div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">Enrollment link</span>
              <input
                readOnly
                value={enrollmentUrl}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[11.5px] text-gray-700"
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onInvited}
                className="rounded-2xl bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Sam Rivera"
                className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">Role</span>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">Email (optional)</span>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="sam@acme.com"
                type="email"
                className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </label>
            {error && (
              <div className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">{error}</div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-2xl border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !form.name.trim()}
                className="rounded-2xl bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'Inviting…' : 'Send invite'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
