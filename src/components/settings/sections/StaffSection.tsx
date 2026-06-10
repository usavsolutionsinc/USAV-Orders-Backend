'use client';

/**
 * /settings?section=staff — admin tool to add staff, set roles, generate
 * one-time enrollment QRs, and disable accounts.
 */

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';

interface StaffRow {
  id: number;
  name: string;
  role: string;
  status: string;
  active: boolean;
  employee_id: string | null;
  employee_code: string | null;
  has_pin: boolean;
  passkey_count: number;
  last_login_at: string | null;
}

const ROLES = [
  'admin', 'receiver', 'packer', 'technician',
  'shipper', 'inventory_manager', 'sales', 'viewer',
] as const;

export function StaffSection() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<typeof ROLES[number]>('packer');
  const [newCode, setNewCode] = useState('');
  const [adding, setAdding] = useState(false);

  const [qrFor, setQrFor] = useState<{ id: number; name: string; url: string; expiresAt: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/staff', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) setErr("You don't have access to this.");
        else setErr('Could not load staff.');
        return;
      }
      const data = await r.json() as { staff: StaffRow[] };
      setRows(data.staff || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addStaff = useCallback(async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), role: newRole, employeeCode: newCode.trim() || null }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Could not add staff.'));
        return;
      }
      setAddOpen(false);
      setNewName('');
      setNewCode('');
      setNewRole('packer');
      await refresh();
    } finally {
      setAdding(false);
    }
  }, [newName, newRole, newCode, refresh]);

  const generateQr = useCallback(async (row: StaffRow) => {
    setErr(null);
    const r = await fetch(`/api/admin/staff/${row.id}/enroll-token`, {
      method: 'POST', credentials: 'include',
    });
    if (!r.ok) {
      setErr('Could not generate enrollment QR.');
      return;
    }
    const data = await r.json() as { token: string; expiresAt: string; url: string };
    setQrFor({ id: row.id, name: row.name, url: data.url, expiresAt: data.expiresAt });
  }, []);

  const setRole = useCallback(async (id: number, role: string) => {
    setErr(null);
    await fetch(`/api/admin/staff/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    await refresh();
  }, [refresh]);

  const disable = useCallback(async (id: number) => {
    if (!confirm('Disable this staff member? Their sessions will be revoked.')) return;
    await fetch(`/api/admin/staff/${id}`, { method: 'DELETE', credentials: 'include' });
    await refresh();
  }, [refresh]);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500">Add staff, set their role, and send enrollment QRs.</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black"
        >
          {addOpen ? 'Cancel' : '+ Add staff'}
        </button>
      </header>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {addOpen && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-500 mb-1">Name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="Jane Doe" />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-500 mb-1">Role</span>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as typeof ROLES[number])} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-gray-500 mb-1">Employee code (optional)</span>
              <input value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="button" disabled={adding || !newName.trim()} onClick={addStaff} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-caption uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Credentials</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-medium text-gray-900">{row.name}</td>
                <td className="px-3 py-2">
                  <select
                    value={row.role}
                    onChange={(e) => void setRole(row.id, e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    {!ROLES.includes(row.role as typeof ROLES[number]) && (
                      <option value={row.role}>{row.role}</option>
                    )}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span className={
                    row.status === 'active' ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800'
                    : row.status === 'invited' ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800'
                    : 'rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700'
                  }>{row.status}</span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  <span className="mr-2">{row.has_pin ? 'PIN ✓' : 'PIN —'}</span>
                  <span>{row.passkey_count} passkey{row.passkey_count === 1 ? '' : 's'}</span>
                </td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button type="button" onClick={() => void generateQr(row)} className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                    Enrollment QR
                  </button>
                  {row.status !== 'disabled' && (
                    <button type="button" onClick={() => void disable(row.id)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                      Disable
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No staff yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {qrFor && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4" onClick={() => setQrFor(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Enroll {qrFor.name}</h2>
            <p className="text-xs text-gray-500 mb-4">
              Have them scan this on their phone. Expires {new Date(qrFor.expiresAt).toLocaleString()}.
            </p>
            <div className="inline-block bg-white p-3 rounded-lg border border-gray-200">
              <QRCode value={qrFor.url} size={220} level="M" />
            </div>
            <p className="mt-3 break-all text-micro text-gray-400">{qrFor.url}</p>
            <button type="button" onClick={() => setQrFor(null)} className="mt-4 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white">Done</button>
          </div>
        </div>
      )}
    </section>
  );
}
