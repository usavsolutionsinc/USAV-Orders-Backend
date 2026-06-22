'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  dispatchManualsUpdated,
  ErrorBanner,
  FieldLabel,
  inputClass,
  ModalShell,
  PrimaryButton,
  SecondaryButton,
} from './manual-crud-shared';

// ─── Folder rename / move ──────────────────────────────────────────────────

interface RenameFolderModalProps {
  open: boolean;
  onClose: () => void;
  oldPath: string;
  fileCount: number;
}

export function RenameFolderModal({ open, onClose, oldPath, fileCount }: RenameFolderModalProps) {
  // Pre-fill with the existing path so the operator just edits in place.
  const [newPath, setNewPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewPath(oldPath);
    setError(null);
    setBusy(false);
  }, [open, oldPath]);

  const looksLikeMove = useMemo(() => {
    if (!newPath || newPath === oldPath) return false;
    const oldParent = oldPath.split('/').slice(0, -1).join('/');
    const newParent = newPath.split('/').slice(0, -1).join('/');
    return oldParent !== newParent;
  }, [oldPath, newPath]);

  const submit = useCallback(async () => {
    const next = newPath.trim().replace(/^\/+|\/+$/g, '');
    if (!next) { setError('New path is required'); return; }
    if (next === oldPath) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/product-manuals/rename-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
      dispatchManualsUpdated();
      toast.success(
        `${looksLikeMove ? 'Moved' : 'Renamed'} folder · ${data.updated ?? fileCount} ${(data.updated ?? fileCount) === 1 ? 'manual' : 'manuals'} updated`,
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rename failed';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [oldPath, newPath, looksLikeMove, fileCount, onClose]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow={looksLikeMove ? 'Move Folder' : 'Rename Folder'}
      title={oldPath}
      busy={busy}
      maxWidth="md"
      footer={
        <>
          <SecondaryButton disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton busy={busy} onClick={submit}>
            {looksLikeMove ? 'Move' : 'Rename'}
          </PrimaryButton>
        </>
      }
    >
      <ErrorBanner message={error} />

      <div>
        <FieldLabel>New Path</FieldLabel>
        <input
          type="text"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="e.g. Audio/Touch"
          className={inputClass}
          autoFocus
        />
        <p className="mt-1 text-micro text-zinc-400">
          Use “/” to nest. Change just the last segment to rename in place, or change a parent to move the folder.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-caption font-semibold text-amber-800">
        This will update <span className="font-black tabular-nums">{fileCount}</span>{' '}
        {fileCount === 1 ? 'manual' : 'manuals'} in this folder and all sub-folders.
      </div>
    </ModalShell>
  );
}
