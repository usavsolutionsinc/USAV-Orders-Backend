import { ChevronLeft, Pencil, Loader2, Trash2, X } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { ChevronRightTiny } from './LibraryPrimitives';

/** Breadcrumb shown when nested inside a folder (never at root). */
export function LibraryBreadcrumb({
  currentPath, onCrumb, onRenameCurrent,
}: {
  currentPath: string[];
  onCrumb: (index: number) => void;
  onRenameCurrent: () => void;
}) {
  return (
    <div className={`flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 bg-white/80 ${SIDEBAR_GUTTER} py-2 backdrop-blur-sm`}>
      <button
        type="button"
        onClick={() => onCrumb(0)}
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <ChevronLeft className="h-3 w-3" />
        All
      </button>
      {currentPath.map((seg, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1">
          <ChevronRightTiny className="h-2.5 w-2.5 text-gray-300" />
          <button
            type="button"
            onClick={() => onCrumb(i + 1)}
            className={`shrink-0 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
              i === currentPath.length - 1
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {seg}
          </button>
        </span>
      ))}
      {/* Rename / move the folder you're currently inside. */}
      <button
        type="button"
        onClick={onRenameCurrent}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-micro font-black uppercase tracking-wider text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700"
        title="Rename or move this folder"
      >
        <Pencil className="h-3 w-3" />
        Rename
      </button>
    </div>
  );
}

/** Bulk action bar — slides up when 1+ items are selected. */
export function BulkActionsBar({
  count, busy, onMove, onDelete, onClear,
}: {
  count: number;
  busy: boolean;
  onMove: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white shadow-xl shadow-zinc-900/30">
      <span className="text-micro font-black uppercase tracking-[0.16em]">{count} selected</span>
      <span className="mx-1 h-4 w-px bg-zinc-700" />
      <button
        type="button"
        onClick={onMove}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-micro font-black uppercase tracking-wider text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        <Pencil className="h-3 w-3" />
        Move
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-micro font-black uppercase tracking-wider text-white transition-colors hover:bg-red-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        title="Clear selection"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
