import { ChevronLeft, Pencil, Trash2, X } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
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
      <Button
        variant="ghost"
        icon={<ChevronLeft className="h-3 w-3" />}
        onClick={() => onCrumb(0)}
        className="shrink-0 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        All
      </Button>
      {currentPath.map((seg, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1">
          <ChevronRightTiny className="h-2.5 w-2.5 text-gray-300" />
          {/* ds-raw-button: breadcrumb segment with custom active fill (bg-gray-900) — segmented-toggle case */}
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
      <HoverTooltip label="Rename or move this folder" asChild>
        <Button
          variant="secondary"
          icon={<Pencil className="h-3 w-3" />}
          onClick={onRenameCurrent}
          ariaLabel="Rename or move this folder"
          className="ml-auto shrink-0 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-700"
        >
          Rename
        </Button>
      </HoverTooltip>
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
      <Button
        variant="ghost"
        icon={<Pencil className="h-3 w-3" />}
        onClick={onMove}
        disabled={busy}
        className="rounded-lg bg-zinc-800 px-2 py-1 text-micro font-black uppercase tracking-wider text-white hover:bg-zinc-700 hover:text-white"
      >
        Move
      </Button>
      <Button
        variant="danger"
        icon={<Trash2 className="h-3 w-3" />}
        loading={busy}
        onClick={onDelete}
        className="rounded-lg bg-red-600 px-2 py-1 text-micro font-black uppercase tracking-wider hover:bg-red-500"
      >
        Delete
      </Button>
      <HoverTooltip label="Clear selection" asChild>
        <IconButton
          icon={<X className="h-3 w-3" />}
          ariaLabel="Clear selection"
          onClick={onClear}
          className="ml-auto inline-flex items-center gap-1 rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        />
      </HoverTooltip>
    </div>
  );
}
