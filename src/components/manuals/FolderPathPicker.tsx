'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, Check, Search, X } from '@/components/Icons';

/**
 * Folder navigator for picking (or creating) a manual's `folder_path`.
 *
 * Why a navigator instead of a free-text input: operators were typing
 * `Sound/Touch` from memory and getting typos / duplicate-but-slightly-off
 * folder trees. Surfacing the *actual* folder list lets them drill in by
 * clicking, see what exists, and only type when creating a new segment.
 *
 * Layout (one panel, vertical):
 *   - Breadcrumb at top — Root → Sound → Touch (click any pill to jump back)
 *   - List of sub-folders at the current depth — click a row to drill in
 *   - "+ New folder" row at the bottom — type a name, hit Create/Enter to
 *     extend the path with a new (not-yet-existing) segment
 *
 * The picker is a CONTROLLED component — parent owns the `value` (the
 * resulting folder_path string like "Sound/Touch") and re-renders on every
 * change. Empty string = root.
 */

interface ManualRow {
  folder_path: string | null;
}

interface FolderNode {
  name: string;
  path: string[];
  fileCount: number;       // files directly in this folder
  childCount: number;
  totalCount: number;      // descendants + own
  children: Map<string, FolderNode>;
}

function buildTree(rows: ManualRow[]): FolderNode {
  const root: FolderNode = { name: '', path: [], fileCount: 0, childCount: 0, totalCount: 0, children: new Map() };
  for (const r of rows) {
    const raw = (r.folder_path || '').trim();
    const segments = raw ? raw.split('/').map((s) => s.trim()).filter(Boolean) : [];
    let node = root;
    const acc: string[] = [];
    if (segments.length === 0) {
      node.fileCount += 1;
      continue;
    }
    for (const seg of segments) {
      acc.push(seg);
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, path: [...acc], fileCount: 0, childCount: 0, totalCount: 0, children: new Map() };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.fileCount += 1;
  }
  function compute(n: FolderNode): number {
    let count = n.fileCount;
    for (const c of n.children.values()) count += compute(c);
    n.totalCount = count;
    n.childCount = n.children.size;
    return count;
  }
  compute(root);
  return root;
}

function getNode(root: FolderNode, path: string[]): FolderNode | null {
  let node = root;
  for (const seg of path) {
    const next = node.children.get(seg);
    if (!next) return null;
    node = next;
  }
  return node;
}

/**
 * Flatten the tree into one entry per folder. Used by the search input so
 * a query like "soundtouch" can match a folder at any depth (and we don't
 * have to drill-click through the hierarchy to find it).
 */
function flattenFolders(root: FolderNode): FolderNode[] {
  const out: FolderNode[] = [];
  function walk(node: FolderNode) {
    if (node.path.length > 0) out.push(node);
    for (const c of node.children.values()) walk(c);
  }
  walk(root);
  return out;
}

/**
 * Same normalize-and-substring trick as the file search: strip non-alphanum
 * and lowercase on both sides, so "soundtouch" finds "Sound/Touch" and
 * "ST20 V25 V35" finds "T20 V25 V35" even with separators differing.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface FolderPathPickerProps {
  value: string;                       // canonical "A/B/C" string ("" = root)
  onChange: (next: string) => void;
}

export function FolderPathPicker({ value, onChange }: FolderPathPickerProps) {
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSeg, setNewSeg] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/product-manuals/search?limit=1000', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRows(data?.success ? data.manuals || [] : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const tree = useMemo(() => buildTree(rows), [rows]);
  const currentSegments = useMemo(
    () => (value ? value.split('/').map((s) => s.trim()).filter(Boolean) : []),
    [value],
  );

  // The currently-selected node might not exist yet in the tree (e.g. the
  // operator just typed a brand-new path). Walk until we lose the trail —
  // sub-folders shown will be relative to the deepest existing ancestor.
  const ancestorDepth = useMemo(() => {
    let depth = 0;
    let node: FolderNode | null = tree;
    for (const seg of currentSegments) {
      const next: FolderNode | null = node?.children.get(seg) ?? null;
      if (!next) break;
      depth += 1;
      node = next;
    }
    return depth;
  }, [tree, currentSegments]);

  const currentExistingPath = currentSegments.slice(0, ancestorDepth);
  const currentNode = useMemo(
    () => getNode(tree, currentExistingPath) ?? tree,
    [tree, currentExistingPath],
  );

  const subfolders = useMemo(
    () => Array.from(currentNode.children.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [currentNode],
  );

  // Search across every folder at every depth. Returns up to 50 best matches
  // sorted by path length (shorter = more likely the intended target).
  const searchResults = useMemo(() => {
    const q = normalize(search);
    if (!q) return null;
    const all = flattenFolders(tree);
    const hits = all
      .map((node) => {
        const fullPath = node.path.join('/');
        const haystack = normalize(fullPath);
        const idx = haystack.indexOf(q);
        if (idx < 0) return null;
        // Score: prefer matches at the start, then shorter paths.
        return { node, fullPath, score: idx + fullPath.length * 0.01 };
      })
      .filter((x): x is { node: FolderNode; fullPath: string; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50);
    return hits;
  }, [search, tree]);

  const handleJumpTo = (index: number) => {
    // index 0 = Root; index N selects segment N-1 as the deepest.
    const next = currentSegments.slice(0, index);
    onChange(next.join('/'));
  };

  const handleDrill = (segment: string) => {
    const next = [...currentSegments, segment];
    onChange(next.join('/'));
  };

  const handleCreate = () => {
    const cleaned = newSeg.trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    if (!cleaned) return;
    const next = currentSegments.concat(cleaned.split('/').filter(Boolean));
    onChange(next.join('/'));
    setNewSeg('');
  };

  const pendingSegments = currentSegments.slice(ancestorDepth);

  const isSearching = !!search.trim();

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {/* Search across every folder at every depth. Bypasses the drill-down
          view when active — operators with deep trees shouldn't have to
          click through 5 levels to find a known folder. */}
      <div className="relative border-b border-zinc-100 bg-white px-2.5 py-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all folders…"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-7 text-caption text-zinc-900 placeholder:text-zinc-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Clear folder search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Breadcrumb (hidden in search mode — the result rows show full paths) */}
      {!isSearching && (
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 bg-zinc-50/70 px-3 py-2">
          <CrumbPill
            label="Root"
            active={currentSegments.length === 0}
            onClick={() => handleJumpTo(0)}
          />
          {currentSegments.map((seg, i) => {
            const isPending = i >= ancestorDepth;
            return (
              <span key={`${i}-${seg}`} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-zinc-300" />
                <CrumbPill
                  label={seg}
                  active={i === currentSegments.length - 1}
                  pending={isPending}
                  onClick={() => handleJumpTo(i + 1)}
                />
              </span>
            );
          })}
        </div>
      )}

      {/* Body: drill-down sub-folders OR flat search results */}
      <div className="max-h-52 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          </div>
        ) : isSearching ? (
          searchResults && searchResults.length > 0 ? (
            <ul className="divide-y divide-zinc-50">
              {searchResults.map(({ node, fullPath }) => (
                <li key={fullPath}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(fullPath);
                      setSearch('');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-blue-50/40"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100">
                      <FolderGlyph className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption font-black text-zinc-800">
                      {node.name}
                      <span className="ml-1 font-mono text-micro font-semibold text-zinc-400">
                        {fullPath}
                      </span>
                    </span>
                    <span className="text-micro font-semibold text-zinc-400">
                      {node.totalCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-micro font-semibold text-zinc-400">
              No folders match “{search}”. Type a name below to create a new one.
            </p>
          )
        ) : subfolders.length === 0 ? (
          <p className="px-3 py-3 text-micro font-semibold text-zinc-400">
            {pendingSegments.length > 0
              ? 'New folder — will be created on save.'
              : 'No sub-folders here. Add one below to nest deeper.'}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-50">
            {subfolders.map((node) => (
              <li key={node.name}>
                <button
                  type="button"
                  onClick={() => handleDrill(node.name)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-blue-50/40"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100">
                    <FolderGlyph className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption font-black text-zinc-800">
                    {node.name}
                  </span>
                  <span className="text-micro font-semibold text-zinc-400">
                    {node.totalCount}
                  </span>
                  <ChevronRight className="h-3 w-3 text-zinc-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* New folder input — hidden in search mode to keep the focus on
          finding what already exists; the empty-results message tells the
          operator how to create one. */}
      {!isSearching && (
        <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/40 px-3 py-2">
          <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <input
            type="text"
            value={newSeg}
            onChange={(e) => setNewSeg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="New folder at this level"
            className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-caption text-zinc-800 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newSeg.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-micro font-black uppercase tracking-wider text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            <Check className="h-3 w-3" />
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function CrumbPill({
  label, active, pending, onClick,
}: {
  label: string;
  active?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  const tone = pending
    ? 'border-dashed border-amber-300 bg-amber-50 text-amber-800'
    : active
      ? 'border-zinc-900 bg-zinc-900 text-white'
      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-black uppercase tracking-wider transition-colors ${tone}`}
    >
      {label}
    </button>
  );
}

function FolderGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}
