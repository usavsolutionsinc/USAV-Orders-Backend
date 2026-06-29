'use client';

/**
 * Modal to create a new (non-system) role. Triggered by "+ Create role"
 * in RolesSidebarPanel. Starts with an empty permission set — admin tunes
 * the toggles in the editor after creation.
 */

import { useCallback, useState } from 'react';
import { Button } from '@/design-system/primitives';

interface CreateRoleDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (newRoleId: number) => void;
}

const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

export function CreateRoleDialog({ open, onClose, onCreated }: CreateRoleDialogProps) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  const submit = useCallback(async () => {
    setErr(null);
    const finalKey = key.trim() || slugify(label);
    if (!label.trim()) { setErr('Label is required.'); return; }
    if (!KEY_RE.test(finalKey)) { setErr('Key must start with a letter and use only lowercase letters, digits, and underscores.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/admin/roles', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: finalKey, label: label.trim(), color, permissions: [] }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const code = String((data as { error?: string }).error || '');
        setErr(code === 'KEY_TAKEN' ? 'That key is already used. Try another.' : code || 'Could not create role.');
        return;
      }
      const data = await r.json() as { role: { id: number } };
      onCreated(data.role.id);
      setLabel(''); setKey(''); setColor('#6b7280');
      onClose();
    } finally {
      setBusy(false);
    }
  }, [label, key, color, onCreated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Create role</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          New role starts with no permissions. Add toggles in the editor after creation.
        </p>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Label</span>
            <input
              autoFocus
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!key) setKey(slugify(e.target.value));
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              placeholder="Shift Lead"
            />
          </label>
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Key (slug)</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40))}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              placeholder="shift_lead"
            />
            <span className="mt-0.5 block text-micro text-gray-400">Stable identifier; cannot be changed later.</span>
          </label>
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Color</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-gray-300"
              />
              <code className="rounded-md bg-gray-100 px-2 py-1 text-caption font-mono text-gray-700">{color}</code>
            </div>
          </label>
        </div>

        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} loading={busy} disabled={!label.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
