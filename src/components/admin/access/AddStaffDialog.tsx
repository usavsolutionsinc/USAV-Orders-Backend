'use client';

/**
 * Compact modal to create a new staff row. Triggered by "+ Add staff" in the
 * AccessSidebarPanel. New rows land with `status='invited'` so the admin can
 * generate an enrollment QR for them right after.
 */

import { useCallback, useState } from 'react';
import { ALL_ROLES } from '@/lib/auth/permissions-shared';

interface AddStaffDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (newStaffId: number) => void;
}

export function AddStaffDialog({ open, onClose, onCreated }: AddStaffDialogProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<typeof ALL_ROLES[number]>('packer');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr('Name is required.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, role, employeeCode: code.trim() || null }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Could not add staff.'));
        return;
      }
      const data = await r.json() as { staff: { id: number } };
      onCreated(data.staff.id);
      setName(''); setCode(''); setRole('packer');
      onClose();
    } finally {
      setBusy(false);
    }
  }, [name, role, code, onCreated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Add staff</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Creates an invited account. Generate an enrollment QR to let them set a PIN.
        </p>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              placeholder="Jane Doe"
            />
          </label>
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof ALL_ROLES[number])}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
            >
              {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Employee code (optional)</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              placeholder="EMP-001"
            />
          </label>
        </div>

        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !name.trim()} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-blue-700">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
