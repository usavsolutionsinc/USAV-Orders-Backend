'use client';

import { useState } from 'react';
import { Loader2, Plus } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { tableHeader } from '@/design-system/tokens/typography/presets';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useDebounce } from '@/hooks';
import { UploadManualModal, RenameFolderModal } from './ManualCrudModals';
import { useManualsData } from './library/hooks/useManualsData';
import { useManualNavigation } from './library/hooks/useManualNavigation';
import { useManualsTree } from './library/hooks/useManualsTree';
import { useManualSelection } from './library/hooks/useManualSelection';
import { useManualDragDrop } from './library/hooks/useManualDragDrop';
import { useThumbnailBackfill } from './library/hooks/useThumbnailBackfill';
import { FolderIcon } from './library/LibraryPrimitives';
import { LibraryBreadcrumb, BulkActionsBar } from './library/LibraryChrome';
import { FolderView, SearchResults } from './library/FolderView';
import { BulkMoveSheet } from './library/BulkMoveSheet';

interface LibraryBrowserProps {
  /** Fuzzy-match needle. Comes from the parent's shared search bar. */
  query: string;
  /** Base route for URL writes (e.g. '/products'). Selected file → ?id=. */
  basePath: string;
}

/**
 * Body-only manuals/library file browser. Headers, mode pills, and the search
 * input are owned by the parent sidebar (`ProductsSidebarPanel`) — this renders
 * the folder tree, breadcrumb, and fuzzy results when `query` is set. URL writes
 * land on `basePath` so the same component mounts under `/products` or
 * `/manuals`. Thin composition layer — state/logic live in `./library/`.
 */
export function LibraryBrowser({ query, basePath }: LibraryBrowserProps) {
  const debouncedQuery = useDebounce(query.trim(), 150);

  const { manuals, setManuals, loading, reloadToken } = useManualsData();
  const nav = useManualNavigation(basePath, manuals);
  const { currentNode, searchResults, subfolders, filesHere } = useManualsTree(
    manuals,
    nav.currentPath,
    debouncedQuery,
  );
  const sel = useManualSelection(reloadToken);
  const dnd = useManualDragDrop(nav.currentFolderPath);
  useThumbnailBackfill(filesHere, debouncedQuery, setManuals);

  // Transient modal state — single instances, no hook warranted.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<{ path: string; count: number } | null>(null);

  // Shared props threaded to both list views.
  const rowProps = {
    selectedId: nav.selectedId,
    onSelectFile: nav.handleSelectFile,
    onRenameFolder: (path: string, count: number) => setRenameFolder({ path, count }),
    selection: sel.selection,
    onToggleSelect: sel.toggleSelected,
    onDropManuals: dnd.dropManualIdsOnFolder,
    onDropFiles: dnd.dropFilesOnFolder,
  };

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col bg-gradient-to-b from-white to-gray-50 ${
        dnd.sidebarDragOver ? 'ring-4 ring-indigo-200 ring-inset' : ''
      }`}
      onDragOver={dnd.handleSidebarDragOver}
      onDragLeave={dnd.handleSidebarDragLeave}
      onDrop={dnd.handleSidebarDrop}
    >
      {!debouncedQuery && nav.currentPath.length > 0 && (
        <LibraryBreadcrumb
          currentPath={nav.currentPath}
          onCrumb={nav.goToCrumb}
          onRenameCurrent={() => setRenameFolder({ path: nav.currentFolderPath, count: currentNode.totalCount })}
        />
      )}

      {/* Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${SIDEBAR_GUTTER} py-3`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
          </div>
        ) : debouncedQuery && searchResults ? (
          <SearchResults results={searchResults} onOpenFolder={(node) => nav.setCurrentPath(node.path)} {...rowProps} />
        ) : currentNode.totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <FolderIcon className="mb-3 h-10 w-10 text-text-faint" />
            <p className={`${tableHeader} text-text-soft`}>No manuals here</p>
          </div>
        ) : (
          <FolderView subfolders={subfolders} files={filesHere} onEnter={nav.enterFolder} {...rowProps} />
        )}
      </div>

      {sel.selection.size > 0 && (
        <BulkActionsBar
          count={sel.selection.size}
          busy={sel.bulkBusy}
          onMove={() => { sel.setMoveTarget(nav.currentFolderPath); sel.setMoveOpen(true); }}
          onDelete={sel.runBulkDelete}
          onClear={sel.clearSelection}
        />
      )}

      {sel.moveOpen && (
        <BulkMoveSheet
          count={sel.selection.size}
          target={sel.moveTarget}
          onTargetChange={sel.setMoveTarget}
          busy={sel.bulkBusy}
          onCancel={() => sel.setMoveOpen(false)}
          onConfirm={sel.runBulkMove}
        />
      )}

      {/* Upload FAB — pre-fills the new manual's folder to the current breadcrumb. */}
      <HoverTooltip label="Upload a manual" asChild>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setUploadOpen(true)}
          ariaLabel="Upload a manual"
          icon={<Plus className="h-3.5 w-3.5" />}
          className="absolute bottom-4 right-4 z-10"
        >
          Upload
        </Button>
      </HoverTooltip>

      <UploadManualModal open={uploadOpen} onClose={() => setUploadOpen(false)} defaultFolderPath={nav.currentFolderPath} />
      <RenameFolderModal
        open={!!renameFolder}
        onClose={() => setRenameFolder(null)}
        oldPath={renameFolder?.path || ''}
        fileCount={renameFolder?.count || 0}
      />
    </div>
  );
}
