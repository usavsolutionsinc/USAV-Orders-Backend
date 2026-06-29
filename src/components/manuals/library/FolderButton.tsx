import { useState } from 'react';
import { Pencil } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { FolderNode } from './manuals-tree';
import { FolderIcon, ChevronRightTiny, HighlightedText } from './LibraryPrimitives';

/**
 * A folder row in the tree/search views. Doubles as a drop target — accepts
 * either internal manual drags (carry the id) or external OS files (uploads).
 * The drag-over ring tells operators where the drop lands.
 */
export function FolderButton({
  node, onEnter, onRename, highlight, onDropManuals, onDropFiles,
}: {
  node: FolderNode;
  onEnter: () => void;
  onRename: () => void;
  highlight?: { label: string; indices: number[] };
  onDropManuals: (ids: number[]) => void;
  onDropFiles: (files: File[]) => void;
}) {
  const subFileCount = node.totalCount;
  const subFolderCount = node.children.size;
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const filesList = Array.from(e.dataTransfer.files || []);
    if (filesList.length > 0) {
      onDropFiles(filesList);
      return;
    }
    const idsRaw = e.dataTransfer.getData('application/x-manual-ids');
    if (idsRaw) {
      const ids: number[] = JSON.parse(idsRaw);
      // Refuse a no-op drop (already in this folder) so the toast doesn't fire "Moved 0".
      if (ids.length > 0) onDropManuals(ids);
    }
  };

  return (
    // Outer is a div (not <button>) so we can nest the rename pencil without
    // putting an interactive button inside another interactive button.
    <div
      className={`group relative flex w-full items-center gap-3 rounded-2xl border bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-indigo-200 hover:bg-indigo-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm ${
        dragOver ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300' : 'border-gray-200'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ds-raw-button — full-card overlay click target */}
      <button type="button" onClick={onEnter} className="absolute inset-0 rounded-2xl" aria-label={`Open folder ${node.name}`} />
      <div className="pointer-events-none relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 group-hover:from-indigo-100 group-hover:to-violet-100 group-hover:text-indigo-600">
        <FolderIcon className="h-4 w-4" />
      </div>
      <div className="pointer-events-none relative min-w-0 flex-1">
        <p className="truncate text-label font-black text-gray-900">
          {highlight ? <HighlightedText text={highlight.label} indices={highlight.indices} /> : node.name}
        </p>
        <p className="mt-0.5 text-micro font-semibold text-gray-500">
          {subFolderCount > 0 && (
            <>
              {subFolderCount} {subFolderCount === 1 ? 'folder' : 'folders'}
              {' · '}
            </>
          )}
          {subFileCount} {subFileCount === 1 ? 'manual' : 'manuals'}
        </p>
      </div>
      <HoverTooltip label="Rename or move folder" asChild>
        {/* ds-raw-button — group-hover reveal pencil on card tile */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100"
          aria-label={`Rename or move ${node.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </HoverTooltip>
      <ChevronRightTiny className="pointer-events-none relative h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" />
    </div>
  );
}
