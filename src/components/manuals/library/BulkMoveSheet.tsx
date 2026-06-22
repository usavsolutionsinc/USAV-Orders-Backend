import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Check, X } from '@/components/Icons';
import { FolderPathPicker } from '../FolderPathPicker';

/**
 * Bulk-move sheet — opens from the bulk action bar's "Move". Body is just the
 * FolderPathPicker (search + drill-down + new-folder). Portals to document.body
 * so the overlay covers the whole viewport, matching the other manual modals.
 */
export function BulkMoveSheet({
  count, target, onTargetChange, busy, onCancel, onConfirm,
}: {
  count: number;
  target: string;
  onTargetChange: (next: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Gate portal until first client render — document.body doesn't exist in SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-panelPopover flex items-center justify-center p-4">
      <button
        type="button"
        onClick={busy ? undefined : onCancel}
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
      />
      <div className="relative z-panelPopover w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <p className="text-micro font-black uppercase tracking-[0.16em] text-zinc-500">Bulk Move</p>
            <h2 className="mt-1 text-sm font-black text-zinc-900">
              Move {count} {count === 1 ? 'manual' : 'manuals'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <FolderPathPicker value={target} onChange={onTargetChange} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-[0.14em] text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-micro font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
