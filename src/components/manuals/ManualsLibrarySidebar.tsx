'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Loader2, Search, X, ChevronLeft } from '@/components/Icons';
import { microBadge, tableHeader } from '@/design-system/tokens/typography/presets';
import { sidebarHeaderBandClass, sidebarHeaderRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

type StatusFilter = 'all' | 'unassigned' | 'assigned' | 'archived';

interface ManualRow {
  id: number;
  product_title: string | null;
  display_name: string | null;
  source_url: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: string;
  type: string | null;
}

const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', tone: 'zinc' },
  { id: 'pairing', label: 'SKU Pairing', tone: 'orange' },
  { id: 'manuals', label: 'Manuals', tone: 'emerald' },
  { id: 'qc', label: 'QC Checklist', tone: 'blue' },
  { id: 'library', label: 'Library', tone: 'purple' },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',        label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'assigned',   label: 'Assigned' },
  { value: 'archived',   label: 'Archived' },
];

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
    case 'manual':          return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'troubleshooting': return 'bg-red-50 text-red-700 border-red-200';
    case 'installation':    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'quick-start':     return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'safety':          return 'bg-orange-50 text-orange-700 border-orange-200';
    default:                return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

// ─── Folder tree types ──────────────────────────────────────────────────────
interface FolderNode {
  name: string;          // this segment, e.g. "Lifestyle"
  path: string[];        // segments from root, e.g. ["Systems", "Surround", "Lifestyle"]
  files: ManualRow[];    // files directly in this folder
  children: Map<string, FolderNode>;
  totalCount: number;    // total files in this folder and all descendants
}

function buildTree(manuals: ManualRow[]): FolderNode {
  const root: FolderNode = { name: '', path: [], files: [], children: new Map(), totalCount: 0 };
  for (const m of manuals) {
    const raw = m.folder_path?.trim() || '(no folder)';
    const segments = raw.split('/').map((s) => s.trim()).filter(Boolean);
    let node = root;
    const acc: string[] = [];
    for (const seg of segments) {
      acc.push(seg);
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, path: [...acc], files: [], children: new Map(), totalCount: 0 };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push(m);
  }
  // Compute total descendant counts in one DFS pass
  function compute(n: FolderNode): number {
    let count = n.files.length;
    for (const child of n.children.values()) count += compute(child);
    n.totalCount = count;
    return count;
  }
  compute(root);
  return root;
}

function getNodeAtPath(root: FolderNode, path: string[]): FolderNode | null {
  let node = root;
  for (const seg of path) {
    const next = node.children.get(seg);
    if (!next) return null;
    node = next;
  }
  return node;
}

// ─── Fuzzy match ────────────────────────────────────────────────────────────
// Returns null if no match, otherwise a score (lower = better) plus match
// indices for highlighting. Sublime-style: all chars of needle appear in
// order; consecutive matches score better; matches at start of word score
// better.
function fuzzyMatch(needle: string, haystack: string): { score: number; indices: number[] } | null {
  if (!needle) return { score: 0, indices: [] };
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let lastIdx = -1;
  let consecutive = 0;
  let nIdx = 0;
  for (let i = 0; i < h.length && nIdx < n.length; i++) {
    if (h[i] === n[nIdx]) {
      indices.push(i);
      const gap = lastIdx === -1 ? 0 : i - lastIdx - 1;
      score += gap;
      // Reward matches at word boundaries
      const atBoundary = i === 0 || /[\s/\-_:.()]/.test(h[i - 1]);
      if (atBoundary) score -= 2;
      if (gap === 0) consecutive++;
      else consecutive = 0;
      score -= consecutive;
      lastIdx = i;
      nIdx++;
    }
  }
  if (nIdx < n.length) return null;
  // Prefer shorter haystacks
  score += haystack.length * 0.01;
  return { score, indices };
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {text.split('').map((char, i) =>
        set.has(i) ? (
          <mark key={i} className="rounded-sm bg-indigo-100 px-px text-indigo-900">
            {char}
          </mark>
        ) : (
          <span key={i}>{char}</span>
        ),
      )}
    </>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────
function FolderIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function ChevronRightTiny({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────
export function ManualsLibrarySidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;
  const urlQuery = searchParams.get('q') ?? '';
  const urlStatus = (searchParams.get('status') as StatusFilter) || 'all';

  const [query, setQuery] = useState(urlQuery);
  const [status, setStatus] = useState<StatusFilter>(urlStatus);
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery);
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  // Sync q + status into URL for deep-links
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedQuery) params.set('q', debouncedQuery);
    else params.delete('q');
    if (status !== 'all') params.set('status', status);
    else params.delete('status');
    const next = params.toString();
    if (next !== searchParams.toString()) {
      router.replace(`/manuals/library${next ? `?${next}` : ''}`);
    }
  }, [debouncedQuery, status, router, searchParams]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: '1000' });
    if (status !== 'all') params.set('status', status);
    // Server-side q is omitted on purpose — we fuzzy-match client-side over
    // the full dataset so folder-name matching highlights correctly.
    fetch(`/api/product-manuals/search?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setManuals(data?.success ? data.manuals || [] : []);
      })
      .catch(() => {
        if (!cancelled) setManuals([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const tree = useMemo(() => buildTree(manuals), [manuals]);
  const currentNode = useMemo(
    () => getNodeAtPath(tree, currentPath) ?? tree,
    [tree, currentPath],
  );

  // ─── Navigation handlers ─────────────────────────────────────────────────
  const handleSelectFile = useCallback(
    (id: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('id', String(id));
      router.replace(`/manuals/library?${params.toString()}`);
    },
    [router, searchParams],
  );

  const enterFolder = useCallback((segment: string) => {
    setCurrentPath((prev) => [...prev, segment]);
  }, []);

  const goToCrumb = useCallback((index: number) => {
    setCurrentPath((prev) => prev.slice(0, index));
  }, []);

  const handleClear = useCallback(() => setQuery(''), []);

  const handleModeChange = useCallback(
    (id: string) => {
      if (id === 'library') return;
      const q = id === 'all' ? '' : `?mode=${id}`;
      router.replace(`/manuals${q}`);
    },
    [router],
  );

  // ─── Search results (folders + files) ────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!debouncedQuery) return null;
    const folderHits: { node: FolderNode; score: number; indices: number[]; label: string }[] = [];
    const fileHits: { manual: ManualRow; score: number; indices: number[]; label: string }[] = [];

    function walk(node: FolderNode) {
      // Match folder by its name (last segment) — folder-name fuzzy search
      if (node.path.length > 0) {
        const label = node.name;
        const m = fuzzyMatch(debouncedQuery, label);
        if (m) folderHits.push({ node, score: m.score, indices: m.indices, label });
      }
      // Match files by display_name primarily, fall back to file_name
      for (const file of node.files) {
        const label = file.display_name || file.file_name || `Manual #${file.id}`;
        const m = fuzzyMatch(debouncedQuery, label);
        if (m) fileHits.push({ manual: file, score: m.score, indices: m.indices, label });
      }
      for (const child of node.children.values()) walk(child);
    }
    walk(tree);

    folderHits.sort((a, b) => a.score - b.score);
    fileHits.sort((a, b) => a.score - b.score);
    return { folderHits, fileHits };
  }, [debouncedQuery, tree]);

  // Auto-navigate to the folder containing the currently-selected file when
  // it's outside the current path (helps after deep-link reload).
  useEffect(() => {
    if (!selectedId) return;
    const file = manuals.find((m) => m.id === selectedId);
    if (!file?.folder_path) return;
    const target = file.folder_path.split('/').map((s) => s.trim()).filter(Boolean);
    setCurrentPath((prev) => (prev.length === 0 ? target : prev));
    // Only on first selection — don't override when user navigates away.
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const subfolders = useMemo(
    () => Array.from(currentNode.children.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [currentNode],
  );

  const filesHere = useMemo(
    () =>
      [...currentNode.files].sort((a, b) =>
        (a.display_name || a.file_name || '').localeCompare(b.display_name || b.file_name || ''),
      ),
    [currentNode],
  );

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <p className="truncate text-caption font-black uppercase tracking-[0.2em] text-gray-900">
          Manuals Library
        </p>
        <span className="text-micro font-black uppercase tracking-[0.18em] text-gray-500">
          {loading ? 'Loading…' : `${tree.totalCount}`}
        </span>
      </div>

      {/* Mode slider */}
      <div className={`shrink-0 border-b border-gray-200 bg-white ${SIDEBAR_GUTTER} py-1.5`}>
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
      <div className={`border-b border-gray-100 bg-white ${SIDEBAR_GUTTER} py-3`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fuzzy search folders & manuals…"
            className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-9 text-label font-semibold text-gray-900 placeholder:text-gray-400 transition-all focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Status pills */}
      <div className={`flex shrink-0 gap-1 border-b border-gray-100 bg-white ${SIDEBAR_GUTTER} py-2`}>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatus(opt.value)}
            className={`flex-1 rounded-xl px-2 py-1.5 text-micro font-black uppercase tracking-wider transition-all ${
              status === opt.value
                ? 'bg-gray-900 text-white shadow-sm shadow-gray-900/20'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Breadcrumb (only when browsing, not searching) */}
      {!debouncedQuery && (
        <div className={`flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 bg-white/80 ${SIDEBAR_GUTTER} py-2 backdrop-blur-sm`}>
          <button
            type="button"
            onClick={() => goToCrumb(0)}
            className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
              currentPath.length === 0
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {currentPath.length > 0 ? <ChevronLeft className="h-3 w-3" /> : null}
            All
          </button>
          {currentPath.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              <ChevronRightTiny className="h-2.5 w-2.5 text-gray-300" />
              <button
                type="button"
                onClick={() => goToCrumb(i + 1)}
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
        </div>
      )}

      {/* Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${SIDEBAR_GUTTER} py-3`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
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
            <FolderIcon className="mb-3 h-10 w-10 text-gray-300" />
            <p className={`${tableHeader} text-gray-500`}>No manuals here</p>
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

// ─── Sub-views ──────────────────────────────────────────────────────────────
function FolderView({
  subfolders,
  files,
  selectedId,
  onEnter,
  onSelectFile,
}: {
  subfolders: FolderNode[];
  files: ManualRow[];
  selectedId: number | null;
  onEnter: (segment: string) => void;
  onSelectFile: (id: number) => void;
}) {
  return (
    <div className="space-y-3">
      {subfolders.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Folders · {subfolders.length}
          </p>
          {subfolders.map((node) => (
            <FolderButton key={node.name} node={node} onEnter={() => onEnter(node.name)} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Files · {files.length}
          </p>
          {files.map((f) => (
            <FileButton
              key={f.id}
              manual={f}
              isSelected={f.id === selectedId}
              onClick={() => onSelectFile(f.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({
  results,
  selectedId,
  onSelectFile,
  onOpenFolder,
}: {
  results: {
    folderHits: { node: FolderNode; score: number; indices: number[]; label: string }[];
    fileHits: { manual: ManualRow; score: number; indices: number[]; label: string }[];
  };
  selectedId: number | null;
  onSelectFile: (id: number) => void;
  onOpenFolder: (node: FolderNode) => void;
}) {
  const { folderHits, fileHits } = results;
  if (folderHits.length === 0 && fileHits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Search className="mb-3 h-8 w-8 text-gray-300" />
        <p className={`${tableHeader} text-gray-500`}>No matches</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {folderHits.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Folders · {folderHits.length}
          </p>
          {folderHits.slice(0, 50).map((hit) => (
            <FolderButton
              key={hit.node.path.join('/')}
              node={hit.node}
              highlight={{ label: hit.label, indices: hit.indices }}
              onEnter={() => onOpenFolder(hit.node)}
            />
          ))}
        </div>
      )}
      {fileHits.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Files · {fileHits.length}
          </p>
          {fileHits.slice(0, 100).map((hit) => (
            <FileButton
              key={hit.manual.id}
              manual={hit.manual}
              isSelected={hit.manual.id === selectedId}
              highlight={{ label: hit.label, indices: hit.indices }}
              onClick={() => onSelectFile(hit.manual.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderButton({
  node,
  onEnter,
  highlight,
}: {
  node: FolderNode;
  onEnter: () => void;
  highlight?: { label: string; indices: number[] };
}) {
  const subFileCount = node.totalCount;
  const subFolderCount = node.children.size;
  return (
    <button
      type="button"
      onClick={onEnter}
      className="group flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-indigo-200 hover:bg-indigo-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 group-hover:from-indigo-100 group-hover:to-violet-100 group-hover:text-indigo-600">
        <FolderIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
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
      <ChevronRightTiny className="h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" />
    </button>
  );
}

function FileButton({
  manual,
  isSelected,
  onClick,
  highlight,
}: {
  manual: ManualRow;
  isSelected: boolean;
  onClick: () => void;
  highlight?: { label: string; indices: number[] };
}) {
  const title = manual.display_name || manual.file_name || `Manual #${manual.id}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all ${
        isSelected
          ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/50 shadow-sm ring-1 ring-inset ring-blue-200'
          : 'border-gray-200 bg-white shadow-sm hover:-translate-y-px hover:border-blue-200 hover:bg-blue-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm'
      }`}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
          isSelected
            ? 'bg-blue-100 text-blue-600 ring-blue-200'
            : 'bg-gray-50 text-gray-500 ring-gray-200 group-hover:bg-blue-50 group-hover:text-blue-500 group-hover:ring-blue-100'
        }`}
      >
        <FileText className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-label font-black leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
          {highlight ? <HighlightedText text={highlight.label} indices={highlight.indices} /> : title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className={`${microBadge} rounded-full border px-1.5 py-0.5 ${statusBadgeClass(manual.status)}`}>
            {manual.status}
          </span>
          {manual.type && (
            <span className={`${microBadge} rounded-full border px-1.5 py-0.5 ${typeBadgeClass(manual.type)}`}>
              {manual.type}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
