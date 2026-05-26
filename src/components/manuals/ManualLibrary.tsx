'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Loader2, ExternalLink, Pencil, Trash2, Plus } from '@/components/Icons';
import { microBadge, tableHeader } from '@/design-system/tokens/typography/presets';
import { toast } from '@/lib/toast';
import {
  EditManualModal,
  UploadManualModal,
  dispatchManualsUpdated,
  type EditManualTarget,
  type ReplaceTarget,
} from './ManualCrudModals';

interface ManualDetail {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  google_file_id: string | null;
  source_url: string | null;
  relative_path: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: string;
  type: string | null;
  updated_at: string | null;
}

function manualHref(m: Pick<ManualDetail, 'source_url' | 'google_file_id'>): string | null {
  if (m.source_url) return m.source_url;
  if (m.google_file_id) return `https://docs.google.com/document/d/${m.google_file_id}`;
  return null;
}

/**
 * Add a cache-bust query param + reattach the PDF viewer hash so an edit-only
 * change (where source_url stays the same but the row's `updated_at` advances)
 * still defeats the browser's iframe cache. Splits on `#` because hash params
 * don't reach the network, so we have to inject the buster before it.
 */
function appendCacheBust(href: string, version: string | number): string {
  const [base, hash] = href.split('#');
  const sep = base.includes('?') ? '&' : '?';
  const next = `${base}${sep}v=${encodeURIComponent(String(version))}`;
  return hash ? `${next}#${hash}` : `${next}#toolbar=1&navpanes=0`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'unassigned': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'assigned':   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'archived':   return 'bg-gray-100 text-gray-500 border-gray-200';
    default:           return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

function typeBadgeClass(type: string | null): string {
  switch ((type || '').toLowerCase()) {
    case 'manual':       return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'packing-list': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'pl-plus-m':    return 'bg-violet-50 text-violet-700 border-violet-200';
    default:             return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

export function ManualLibrary() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get('id');
  const id = idParam ? Number(idParam) : null;
  const [manual, setManual] = useState<ManualDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!id) {
      setManual(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/product-manuals?id=${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        // The CRUD handler returns the row directly (or an error object)
        if (data && typeof data === 'object' && 'id' in data) setManual(data as ManualDetail);
        else setManual(null);
      })
      .catch(() => {
        if (!cancelled) setManual(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  // Re-fetch when ANY modal fires a manuals-update event — covers edits to
  // this manual + replaces (new source_url to swap into the iframe).
  useEffect(() => {
    const onUpdated = () => setReloadToken((n) => n + 1);
    window.addEventListener('manuals-updated', onUpdated);
    return () => window.removeEventListener('manuals-updated', onUpdated);
  }, []);

  if (!id) return <EmptyViewer />;
  if (loading && !manual) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (!manual) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 px-8 text-center">
        <FileText className="mb-3 h-10 w-10 text-gray-300" />
        <p className={`${tableHeader} text-gray-500`}>Manual not found</p>
      </div>
    );
  }
  return <ManualViewer manual={manual} />;
}

function ManualViewer({ manual }: { manual: ManualDetail }) {
  const href = manualHref(manual);
  const isBlobPdf = !!manual.source_url;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const editTarget: EditManualTarget = {
    id: manual.id,
    displayName: manual.display_name,
    folderPath: manual.folder_path,
    type: manual.type,
    status: manual.status,
    sku: manual.sku,
    itemNumber: manual.item_number,
  };
  const replaceTarget: ReplaceTarget = {
    id: manual.id,
    displayName: manual.display_name,
    folderPath: manual.folder_path,
  };

  const handleDelete = useCallback(async () => {
    // No confirm dialog — the toast's Undo button is the safety net.
    // Internal-tool ergonomic: destructive actions feel cheap, but a
    // 10-second window to take it back means accidents don't bite.
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/product-manuals?id=${manual.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      dispatchManualsUpdated();
      // Clear the ?id= so the viewer falls back to its empty state.
      const params = new URLSearchParams(searchParams.toString());
      params.delete('id');
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname);

      const label = manual.display_name || `Manual #${manual.id}`;
      toast.success(`Deleted “${label}”`, {
        duration: 10_000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              const restoreRes = await fetch('/api/product-manuals', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: manual.id, isActive: true }),
              });
              if (!restoreRes.ok) throw new Error(`HTTP ${restoreRes.status}`);
              dispatchManualsUpdated();
              toast.success(`Restored “${label}”`);
              // Re-open the manual in the viewer.
              const next = new URLSearchParams(searchParams.toString());
              next.set('id', String(manual.id));
              router.replace(`?${next.toString()}`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Restore failed');
            }
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setDeleteError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }, [manual.id, manual.display_name, router, searchParams]);

  return (
    <div className="flex h-full w-full flex-col bg-gray-50">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-gray-900">
            {manual.display_name || manual.file_name || `Manual #${manual.id}`}
          </p>
          {manual.product_title && (
            <p className="mt-0.5 truncate text-caption font-medium text-gray-500">
              {manual.product_title}
            </p>
          )}
          {manual.folder_path && (
            <p className="mt-1 truncate font-mono text-micro text-gray-400">{manual.folder_path}</p>
          )}
          {deleteError && (
            <p className="mt-1 text-micro font-semibold text-red-600">{deleteError}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`${microBadge} rounded-full border px-2 py-1 ${statusBadgeClass(manual.status)}`}>
            {manual.status}
          </span>
          {manual.type && (
            <span className={`${microBadge} rounded-full border px-2 py-1 ${typeBadgeClass(manual.type)}`}>
              {manual.type}
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-wider text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            title="Edit manual metadata"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setReplaceOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-wider text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            title="Replace the underlying file"
          >
            <Plus className="h-3 w-3" />
            Replace
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-wider text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
            title="Soft-delete this manual"
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete
          </button>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-gray-800"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          )}
        </div>
      </div>

      <EditManualModal open={editOpen} onClose={() => setEditOpen(false)} target={editTarget} />
      <UploadManualModal
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        replaceTarget={replaceTarget}
      />

      <div className="min-h-0 flex-1 overflow-hidden bg-gray-100">
        {isBlobPdf && href ? (
          // Key on id + source_url so a Replace (new URL) forces a fresh mount.
          // The cache-bust param on the URL itself handles the Edit-only case
          // where the server renamed the blob to match a new display name —
          // browsers cache iframes aggressively, so just changing the src
          // attribute isn't always enough.
          <iframe
            key={`${manual.id}::${manual.source_url || ''}`}
            src={appendCacheBust(href, manual.updated_at || String(manual.id))}
            title={manual.display_name || `Manual ${manual.id}`}
            className="h-full w-full border-0 bg-white"
          />
        ) : href ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <FileText className="mb-3 h-10 w-10 text-gray-300" />
            <p className={`${tableHeader} text-gray-500`}>Preview unavailable for this source</p>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-gray-800"
            >
              <ExternalLink className="h-3 w-3" /> Open in new tab
            </a>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <FileText className="mb-3 h-10 w-10 text-gray-300" />
            <p className={`${tableHeader} text-gray-500`}>No file URL on this manual</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 px-8 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
        <FileText className="h-6 w-6 text-gray-300" />
      </div>
      <p className="text-sm font-black text-gray-900">Select a manual to preview</p>
      <p className="mt-1 max-w-sm text-caption font-medium text-gray-500">
        Use the sidebar to search by product title, folder, or file name. PDFs render inline.
      </p>
    </div>
  );
}
