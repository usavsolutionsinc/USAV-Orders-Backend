'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/design-system/primitives';

interface DuplicateRoleDialogProps {
  open: boolean;
  sourceRoleId: number;
  sourceLabel: string;
  onClose: () => void;
  onDuplicated: (newRoleId: number) => void;
}

const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

export function DuplicateRoleDialog({ open, sourceRoleId, sourceLabel, onClose, onDuplicated }: DuplicateRoleDialogProps) {
  const [label, setLabel] = useState(`${sourceLabel} (copy)`);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setErr(null);
    const finalKey = key.trim();
    if (!KEY_RE.test(finalKey)) { setErr('Key must start with a letter; lowercase letters, digits, underscores only.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/roles/${sourceRoleId}/duplicate`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: finalKey, label: label.trim() || undefined }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const code = String((data as { error?: string }).error || '');
        setErr(code === 'KEY_TAKEN' ? 'That key is already used.' : code || 'Could not duplicate.');
        return;
      }
      const data = await r.json() as { role: { id: number } };
      onDuplicated(data.role.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [sourceRoleId, label, key, onDuplicated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-scrim/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-surface-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-default">Duplicate role</h2>
        <p className="mt-0.5 text-xs text-text-soft">Copies permissions and color from <b>{sourceLabel}</b>.</p>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-text-soft">New label</span>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              className="mt-1 w-full rounded-md border border-border-default px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
            />
          </label>
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-text-soft">New key</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40))}
              placeholder="shift_lead"
              className="mt-1 w-full rounded-md border border-border-default px-2.5 py-1.5 text-sm font-mono outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
            />
          </label>
        </div>

        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} loading={busy} disabled={!key.trim()}>
            Duplicate
          </Button>
        </div>
      </div>
    </div>
  );
}
