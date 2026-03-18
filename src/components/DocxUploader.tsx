'use client';

import { useState, useRef } from 'react';
import { getSidecarUrl, isElectron } from '@/utils/isElectron';

interface UploadedFile {
  filePath: string;
  fileName: string;
}

/**
 * Upload a .docx / .doc / .pdf file to the local Express sidecar and optionally
 * send it to the default system printer via the native OS print verb.
 *
 * This component works in both Electron (uses local sidecar on port 3001) and
 * browser contexts (shows a clear "desktop only" message for the print feature).
 */
export default function DocxUploader() {
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: '',
  });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus({ type: 'loading', message: 'Uploading…' });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${getSidecarUrl()}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? 'Upload failed');
      }

      const data = await res.json();
      setUploaded({ filePath: data.filePath, fileName: data.fileName });
      setStatus({ type: 'success', message: `Uploaded: ${data.fileName}` });
    } catch (err) {
      setStatus({ type: 'error', message: `Upload failed: ${(err as Error).message}` });
    }

    // Reset input so the same file can be re-uploaded
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handlePrint() {
    if (!uploaded) return;

    if (!isElectron()) {
      setStatus({ type: 'error', message: 'Native printing is only available in the desktop app.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Sending to printer…' });

    try {
      const res = await fetch(`${getSidecarUrl()}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: uploaded.filePath }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Print failed');
      }

      setStatus({ type: 'success', message: 'Sent to printer!' });
    } catch (err) {
      setStatus({ type: 'error', message: `Print error: ${(err as Error).message}` });
    }
  }

  const statusColor =
    status.type === 'success'
      ? 'text-green-400'
      : status.type === 'error'
        ? 'text-red-400'
        : status.type === 'loading'
          ? 'text-blue-400 animate-pulse'
          : 'text-slate-400';

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-800 rounded-xl border border-slate-700">
      <p className="text-sm font-medium text-slate-200">Document Upload &amp; Print</p>

      <label className="flex items-center gap-2 cursor-pointer">
        <span className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
          Choose file…
        </span>
        <span className="text-xs text-slate-400">.docx, .doc, .pdf (max 20 MB)</span>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.doc,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleUpload}
          className="sr-only"
        />
      </label>

      {uploaded && (
        <button
          onClick={handlePrint}
          disabled={status.type === 'loading'}
          className="flex items-center gap-1.5 w-fit px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          Print {uploaded.fileName}
        </button>
      )}

      {status.message && (
        <p className={`text-xs ${statusColor}`}>{status.message}</p>
      )}
    </div>
  );
}
