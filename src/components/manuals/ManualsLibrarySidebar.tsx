'use client';

import { Loader2, Search, X, ChevronLeft } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { tableHeader } from '@/design-system/tokens/typography/presets';
import { sidebarHeaderBandClass, sidebarHeaderRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { MODE_ITEMS, STATUS_OPTIONS } from './manuals-library-sidebar/manuals-library-shared';
import { useManualsLibrary } from './manuals-library-sidebar/useManualsLibrary';
import { FolderIcon, ChevronRightTiny } from './manuals-library-sidebar/manuals-library-icons';
import { FolderView } from './manuals-library-sidebar/FolderView';
import { SearchResults } from './manuals-library-sidebar/SearchResults';

/**
 * Manuals library sidebar — thin composition shell. The status-filtered fetch,
 * folder-tree build, fuzzy search, and breadcrumb navigation live in
 * {@link useManualsLibrary}; the folder/search views + buttons are
 * presentational components under `./manuals-library-sidebar/`.
 */
export function ManualsLibrarySidebar() {
  const c = useManualsLibrary();
  const {
    selectedId, query, setQuery, status, setStatus, loading,
    debouncedQuery, currentPath, setCurrentPath, tree, currentNode,
    searchResults, subfolders, filesHere,
    handleSelectFile, enterFolder, goToCrumb, handleClear, handleModeChange,
  } = c;

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <p className="truncate text-caption font-black uppercase tracking-[0.2em] text-text-default">
          Manuals Library
        </p>
        <span className="text-micro font-black uppercase tracking-[0.18em] text-text-soft">
          {loading ? 'Loading…' : `${tree.totalCount}`}
        </span>
      </div>

      {/* Mode slider */}
      <div className={`shrink-0 border-b border-border-soft bg-surface-card ${SIDEBAR_GUTTER} py-1.5`}>
        <HorizontalButtonSlider
          items={MODE_ITEMS}
          value="library"
          onChange={handleModeChange}
          variant="fba"
          size="md"
          aria-label="Catalog mode"
        />
      </div>

      {/* Search */}
      <div className={`border-b border-border-hairline bg-surface-card ${SIDEBAR_GUTTER} py-3`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fuzzy search folders & manuals…"
            className="w-full rounded-2xl border border-border-soft bg-surface-canvas py-2.5 pl-10 pr-9 text-label font-semibold text-text-default placeholder:text-text-faint transition-all focus:border-indigo-300 focus:bg-surface-card focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
          {query && (
            <IconButton
              icon={<X className="h-3.5 w-3.5" />}
              onClick={handleClear}
              ariaLabel="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-surface-sunken"
            />
          )}
        </div>
      </div>

      {/* Status pills */}
      <div className={`flex shrink-0 gap-1 border-b border-border-hairline bg-surface-card ${SIDEBAR_GUTTER} py-2`}>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatus(opt.value)}
            className={`ds-raw-button flex-1 rounded-xl px-2 py-1.5 text-micro font-black uppercase tracking-wider transition-all ${
              status === opt.value
                ? 'bg-surface-inverse text-white shadow-sm shadow-gray-900/20'
                : 'text-text-soft hover:bg-surface-sunken hover:text-text-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Breadcrumb (only when browsing, not searching) */}
      {!debouncedQuery && (
        <div className={`flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-hairline bg-surface-card/80 ${SIDEBAR_GUTTER} py-2 backdrop-blur-sm`}>
          <button
            type="button"
            onClick={() => goToCrumb(0)}
            className={`ds-raw-button flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
              currentPath.length === 0
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-text-soft hover:bg-surface-sunken hover:text-text-muted'
            }`}
          >
            {currentPath.length > 0 ? <ChevronLeft className="h-3 w-3" /> : null}
            All
          </button>
          {currentPath.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              <ChevronRightTiny className="h-2.5 w-2.5 text-text-faint" />
              <button
                type="button"
                onClick={() => goToCrumb(i + 1)}
                className={`ds-raw-button shrink-0 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
                  i === currentPath.length - 1
                    ? 'bg-surface-inverse text-white'
                    : 'text-text-soft hover:bg-surface-sunken hover:text-text-muted'
                }`}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${SIDEBAR_GUTTER} py-3`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
          </div>
        ) : debouncedQuery && searchResults ? (
          <SearchResults
            results={searchResults}
            selectedId={selectedId}
            onSelectFile={handleSelectFile}
            onOpenFolder={(node) => {
              setCurrentPath(node.path);
              setQuery('');
            }}
          />
        ) : currentNode.totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <FolderIcon className="mb-3 h-10 w-10 text-text-faint" />
            <p className={`${tableHeader} text-text-soft`}>No manuals here</p>
          </div>
        ) : (
          <FolderView
            subfolders={subfolders}
            files={filesHere}
            selectedId={selectedId}
            onEnter={enterFolder}
            onSelectFile={handleSelectFile}
          />
        )}
      </div>
    </div>
  );
}
