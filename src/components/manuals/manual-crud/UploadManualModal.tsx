'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { FolderPathPicker } from '../FolderPathPicker';
import { generatePdfThumbnail } from '@/lib/manuals/pdfThumbnail';
import {
  dispatchManualsUpdated,
  ErrorBanner,
  FieldLabel,
  inputClass,
  ModalShell,
  PrimaryButton,
  SecondaryButton,
  selectClass,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from './manual-crud-shared';

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
