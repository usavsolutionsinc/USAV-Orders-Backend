'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Loader2, X } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { FolderPathPicker } from './FolderPathPicker';
import { generatePdfThumbnail } from '@/lib/manuals/pdfThumbnail';

/**
 * CRUD modal set for the manuals library.
 *
 *   - <UploadManualModal>      — new upload, OR replace if `replaceTarget` given.
 *                                Multipart POST to /api/product-manuals/upload.
 *   - <EditManualModal>        — metadata edit (display name, folder, type,
 *                                status, sku, item number). PATCH JSON to
 *                                /api/product-manuals.
 *   - <RenameFolderModal>      — rename or move a folder. POST to
 *                                /api/product-manuals/rename-folder.
 *
 * All three dispatch a `manuals-updated` window event on success so the
 * `LibraryBrowser` refetches without prop-drilling.
 *
 * Modal shell is shared to keep visual conventions (z-index, backdrop,
 * close-on-esc, focus) consistent — copy of the pattern used in
 * `FbaQuickAddFnskuModal`.
 */

// ─── Shared shell ──────────────────────────────────────────────────────────

const MANUALS_UPDATED_EVENT = 'manuals-updated';

export function dispatchManualsUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MANUALS_UPDATED_EVENT));
  }
}

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  busy: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg';
}

function ModalShell({
  open, onClose, eyebrow, title, busy, children, footer, maxWidth = 'md',
}: ModalShellProps) {
  // Close on ESC (but not while a request is in flight — easy to lose work).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Render flag — createPortal needs document.body, which doesn't exist
  // during SSR. Gate the portal until after first client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  const widthClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[maxWidth];

  // Portal to body so the overlay escapes the sidebar's stacking context
  // and centers over the whole viewport — fixed positioning alone gets
  // trapped if any ancestor sets transform/filter/will-change.
  return createPortal(
    <div className="fixed inset-0 z-panelPopover flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={() => { if (!busy) onClose(); }}
      />
      <div className={`relative z-panelPopover w-full ${widthClass} overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20`}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <p className="text-micro font-black uppercase tracking-[0.16em] text-zinc-500">{eyebrow}</p>
            <h2 className="mt-1 text-sm font-black text-zinc-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-micro font-black uppercase tracking-[0.14em] text-zinc-500">
      {children}
    </span>
  );
}

const inputClass =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100';

const selectClass = inputClass + ' appearance-none bg-white';

function PrimaryButton({
  busy, disabled, children, onClick, danger,
}: {
  busy?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  const base = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-micro font-black uppercase tracking-[0.14em] text-white transition-colors disabled:opacity-50';
  const tone = danger
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-gray-900 hover:bg-gray-800';
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={`${base} ${tone}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-[0.14em] text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-caption font-semibold text-red-700">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: '',             label: 'Unspecified' },
  { value: 'manual',       label: 'Manual' },
  { value: 'packing-list', label: 'Packing List' },
  { value: 'pl-plus-m',    label: 'PL + M' },
];

const STATUS_OPTIONS = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'assigned',   label: 'Assigned' },
  { value: 'archived',   label: 'Archived' },
];

// ─── Upload (and Replace) ──────────────────────────────────────────────────

export interface ReplaceTarget {
  id: number;
  displayName: string | null;
  folderPath: string | null;
}

interface UploadManualModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill folder; usually the current breadcrumb path. */
  defaultFolderPath?: string;
  /** When present, this is a Replace-file operation, not a new upload. */
  replaceTarget?: ReplaceTarget | null;
}

export function UploadManualModal({
  open, onClose, defaultFolderPath = '', replaceTarget = null,
}: UploadManualModalProps) {
  const isReplace = !!replaceTarget;
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [type, setType] = useState('');
  const [sku, setSku] = useState('');
  const [itemNumber, setItemNumber] = useState('');
  const [status, setStatus] = useState<'unassigned' | 'assigned' | 'archived'>('unassigned');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Word docs get converted to PDF server-side, which adds a few seconds —
  // surface that in the submit button so the wait doesn't read as a hang.
  const isWordDoc = useMemo(() => {
    if (!file) return false;
    return /\.docx?$/i.test(file.name)
      || file.type === 'application/msword'
      || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }, [file]);

  // Reset state whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError(null);
    setBusy(false);
    setFolderPath(replaceTarget?.folderPath ?? defaultFolderPath);
    setDisplayName(replaceTarget?.displayName ?? '');
    setType('');
    setSku('');
    setItemNumber('');
    setStatus('unassigned');
  }, [open, defaultFolderPath, replaceTarget]);

  // Auto-fill display name from the picked file's basename.
  const handleFile = useCallback((next: File | null) => {
    setFile(next);
    if (next && !displayName.trim()) {
      setDisplayName(next.name.replace(/\.[a-z0-9]+$/i, ''));
    }
  }, [displayName]);

  const submit = useCallback(async () => {
    if (!file) { setError('Pick a file first'); return; }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (replaceTarget) form.append('id', String(replaceTarget.id));
      if (displayName.trim()) form.append('displayName', displayName.trim());
      if (folderPath.trim()) form.append('folderPath', folderPath.trim());
      if (type) form.append('type', type);
      if (sku.trim()) form.append('sku', sku.trim());
      if (itemNumber.trim()) form.append('itemNumber', itemNumber.trim());
      if (!replaceTarget) form.append('status', status);

      // Generate a thumbnail in parallel — best-effort. If pdfjs fails (the
      // PDF is encrypted, the source isn't actually a PDF, etc.), we just
      // ship the upload without one and the sidebar shows the generic icon.
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const thumb = await generatePdfThumbnail(file);
        if (thumb) {
          form.append('thumbnail', new File([thumb.blob], 'thumb.jpg', { type: 'image/jpeg' }));
        }
      }

      const res = await fetch('/api/product-manuals/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      dispatchManualsUpdated();
      toast.success(
        replaceTarget
          ? `Replaced “${displayName || file.name}”`
          : `Uploaded “${displayName || file.name}”${folderPath ? ` to ${folderPath}` : ''}`,
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [file, replaceTarget, displayName, folderPath, type, sku, itemNumber, status, onClose]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow={isReplace ? 'Replace File' : 'Upload Manual'}
      title={isReplace ? `Replace "${replaceTarget?.displayName || 'manual'}"` : 'Upload a new manual'}
      busy={busy}
      footer={
        <>
          <SecondaryButton disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton busy={busy} disabled={!file} onClick={submit}>
            {busy && isWordDoc ? 'Converting…' : isReplace ? 'Replace' : 'Upload'}
          </PrimaryButton>
        </>
      }
    >
      <ErrorBanner message={error} />

      {/* File picker — drop zone */}
      <label
        htmlFor="manual-upload-file"
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          file
            ? 'border-emerald-200 bg-emerald-50/50'
            : 'border-zinc-200 bg-zinc-50 hover:border-blue-300 hover:bg-blue-50/30'
        }`}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        {file ? (
          <>
            <Check className="h-5 w-5 text-emerald-600" />
            <p className="text-caption font-black text-emerald-900">{file.name}</p>
            <p className="text-micro font-semibold text-emerald-700">{(file.size / 1024).toFixed(1)} KB · click to swap</p>
          </>
        ) : (
          <>
            <p className="text-caption font-black text-zinc-700">Drop a PDF or Word doc here, or click to pick</p>
            <p className="text-micro font-semibold text-zinc-500">Word files (.doc/.docx) are converted to PDF automatically · Max 50MB</p>
          </>
        )}
        <input
          id="manual-upload-file"
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
        />
      </label>

      <div>
        <FieldLabel>Display Name</FieldLabel>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Defaults to file name"
          className={inputClass}
        />
      </div>

      <div>
        <FieldLabel>Folder</FieldLabel>
        <FolderPathPicker value={folderPath} onChange={setFolderPath} />
      </div>

      {!isReplace && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Type</FieldLabel>
            <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className={selectClass}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!isReplace && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>SKU</FieldLabel>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Item Number</FieldLabel>
            <input
              type="text"
              value={itemNumber}
              onChange={(e) => setItemNumber(e.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ─── Edit metadata ─────────────────────────────────────────────────────────

export interface EditManualTarget {
  id: number;
  displayName: string | null;
  folderPath: string | null;
  type: string | null;
  status: string;
  sku: string | null;
  itemNumber: string | null;
}

interface EditManualModalProps {
  open: boolean;
  onClose: () => void;
  target: EditManualTarget | null;
}

export function EditManualModal({ open, onClose, target }: EditManualModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [type, setType] = useState('');
  const [sku, setSku] = useState('');
  const [itemNumber, setItemNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setDisplayName(target.displayName ?? '');
    setType(target.type ?? '');
    setSku(target.sku ?? '');
    setItemNumber(target.itemNumber ?? '');
    setError(null);
    setBusy(false);
  }, [open, target]);

  const submit = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      // Folder path + status are intentionally omitted from this payload —
      // folder lives in the sidebar's rename flow, status is derived from
      // assignment state and not edited inline here.
      const res = await fetch('/api/product-manuals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: target.id,
          displayName: displayName.trim() || null,
          type: type || null,
          sku: sku.trim() || null,
          itemNumber: itemNumber.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      dispatchManualsUpdated();
      toast.success(`Saved “${displayName.trim() || target.displayName || `Manual #${target.id}`}”`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [target, displayName, type, sku, itemNumber, onClose]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow="Edit Manual"
      title={target?.displayName || 'Manual details'}
      busy={busy}
      footer={
        <>
          <SecondaryButton disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton busy={busy} onClick={submit}>Save</PrimaryButton>
        </>
      }
    >
      <ErrorBanner message={error} />

      <div>
        <FieldLabel>Display Name</FieldLabel>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <FieldLabel>Type</FieldLabel>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>SKU</FieldLabel>
          <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
        </div>
        <div>
          <FieldLabel>Item Number</FieldLabel>
          <input
            type="text"
            value={itemNumber}
            onChange={(e) => setItemNumber(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </ModalShell>
  );
}

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
