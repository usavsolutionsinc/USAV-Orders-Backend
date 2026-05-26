'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Loader2, Search, ChevronLeft, Plus, Pencil, Check, X, Trash2 } from '@/components/Icons';
import { microBadge, tableHeader } from '@/design-system/tokens/typography/presets';
import { toast } from '@/lib/toast';
import { UploadManualModal, RenameFolderModal, dispatchManualsUpdated } from './ManualCrudModals';
import { FolderPathPicker } from './FolderPathPicker';
import { generatePdfThumbnail } from '@/lib/manuals/pdfThumbnail';

/**
 * Body-only manuals/library file browser. Headers, mode pills, and the search
 * input are owned by the parent sidebar (`ProductsSidebarPanel`) — this
 * component just renders the folder tree, breadcrumb, status filter, and the
 * fuzzy-match results when `query` is set.
 *
 * URL writes (selected file = `?id=`) land on `basePath` so the same component
 * can be mounted under `/products` or `/manuals` without forking.
 */

interface ManualRow {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: string;
  type: string | null;
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

interface FolderNode {
  name: string;
  path: string[];
  files: ManualRow[];
  children: Map<string, FolderNode>;
  totalCount: number;
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

/**
 * Path-aware normalized matcher.
 *
 * Why this exists: the prior matcher looked at folder names and file names in
 * isolation, so a query like "SoundTouch" couldn't find a file at
 * `Sound/Touch/Bose SoundTouch 30 Manual` — neither folder name alone matched,
 * and the gap-penalty version of the fuzzy match scored the path-spanning hit
 * worse than noise.
 *
 * The fix: lowercase + strip non-alphanumerics on BOTH sides so separators
 * (spaces, slashes, dashes, parens, dots) become invisible. "SoundTouch" then
 * normalizes to "soundtouch" and matches "Sound/Touch/Bose SoundTouch 30…"
 * (which flattens to "soundtouchbosesoundtouch30…") via plain substring.
 *
 * `displayLabel` is the string the user sees on the row — we use it for the
 * highlight character map. `extraHaystack` is everything else we want
 * searchable (full folder_path, product_title, sku, item_number) but don't
 * need to highlight. The score prefers matches that landed in the display
 * label, then earlier positions, then shorter haystacks.
 *
 * Returns null when the query doesn't appear anywhere in label+extra; an
 * empty needle returns score 0 / no indices (everything matches).
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function smartMatch(
  needle: string,
  displayLabel: string,
  extraHaystack: string,
): { score: number; indices: number[] } | null {
  const n = normalize(needle);
  if (!n) return { score: 0, indices: [] };

  const labelNorm = normalize(displayLabel);
  const fullNorm = normalize(`${displayLabel} ${extraHaystack}`);

  const labelHit = labelNorm.indexOf(n);
  if (labelHit < 0 && !fullNorm.includes(n)) return null;

  // Lower score = better. Label-internal hits win over extra-only hits.
  const positionScore = labelHit >= 0 ? labelHit : 100 + fullNorm.indexOf(n);
  const score = positionScore + fullNorm.length * 0.01;

  // Build highlight indices against the ORIGINAL display label by mapping
  // each surviving (alphanumeric) char back to its source position.
  const indices: number[] = [];
  if (labelHit >= 0) {
    const labelToOrig: number[] = [];
    for (let i = 0; i < displayLabel.length; i++) {
      if (/[a-z0-9]/i.test(displayLabel[i])) labelToOrig.push(i);
    }
    for (let i = 0; i < n.length; i++) {
      const idx = labelToOrig[labelHit + i];
      if (idx !== undefined) indices.push(idx);
    }
  }
  return { score, indices };
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {text.split('').map((char, i) =>
        set.has(i) ? (
          <mark key={i} className="rounded-sm bg-indigo-100 px-px text-indigo-900">{char}</mark>
        ) : (
          <span key={i}>{char}</span>
        ),
      )}
    </>
  );
}

function FolderIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

interface LibraryBrowserProps {
  /** Fuzzy-match needle. Comes from the parent's shared search bar. */
  query: string;
  /** Base route for URL writes (e.g. '/products'). Selected file → ?id=. */
  basePath: string;
}

export function LibraryBrowser({ query, basePath }: LibraryBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;

  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<{ path: string; count: number } | null>(null);
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');

  // Drop selection whenever the underlying manuals list refetches — the
  // selected ids may no longer exist (deleted/moved out of view).
  useEffect(() => {
    setSelection(new Set());
  }, [reloadToken]);

  const toggleSelected = useCallback((id: number, additive: boolean) => {
    setSelection((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/product-manuals/search?limit=1000`, { cache: 'no-store' })
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
    return () => { cancelled = true; };
  }, [reloadToken]);

  // Any modal in ManualCrudModals dispatches `manuals-updated` on success;
  // the right-pane ManualLibrary also re-fires after delete. Refetch in
  // response so the tree stays in sync without prop-drilling.
  useEffect(() => {
    const onUpdated = () => setReloadToken((n) => n + 1);
    window.addEventListener('manuals-updated', onUpdated);
    return () => window.removeEventListener('manuals-updated', onUpdated);
  }, []);

  // Track which manual ids we've already tried to backfill in this session.
  // Without this, a render that updates after the upload finishes would
  // re-queue every successful row again. Module-scope set would persist
  // across re-mounts; instance ref scopes it to the lifetime of this
  // component which is appropriate (a navigation away genuinely wants to
  // forget — the next mount can retry any thumbnails the server saved
  // since but the local row hasn't refreshed).
  const backfillAttemptedRef = useRef<Set<number>>(new Set());

  const tree = useMemo(() => buildTree(manuals), [manuals]);
  const currentNode = useMemo(
    () => getNodeAtPath(tree, currentPath) ?? tree,
    [tree, currentPath],
  );

  const handleSelectFile = useCallback(
    (id: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('id', String(id));
      router.replace(`${basePath}?${params.toString()}`);
    },
    [router, searchParams, basePath],
  );

  const enterFolder = useCallback((segment: string) => {
    setCurrentPath((prev) => [...prev, segment]);
  }, []);

  const goToCrumb = useCallback((index: number) => {
    setCurrentPath((prev) => prev.slice(0, index));
  }, []);

  const searchResults = useMemo(() => {
    if (!debouncedQuery) return null;
    const folderHits: { node: FolderNode; score: number; indices: number[]; label: string }[] = [];
    const fileHits: { manual: ManualRow; score: number; indices: number[]; label: string }[] = [];

    function walk(node: FolderNode) {
      if (node.path.length > 0) {
        const label = node.name;
        // Full path goes in the extra haystack so "SoundTouch" matches a
        // folder named "Touch" sitting under "Sound".
        const m = smartMatch(debouncedQuery, label, node.path.join(' '));
        if (m) folderHits.push({ node, score: m.score, indices: m.indices, label });
      }
      for (const file of node.files) {
        const label = file.display_name || file.file_name || `Manual #${file.id}`;
        // Everything searchable but not displayed: folder path, the product
        // title, the file name (if different from display_name), SKU + item
        // number. Operators search by any of these in practice.
        const extra = [
          file.folder_path || '',
          file.product_title || '',
          file.file_name && file.file_name !== file.display_name ? file.file_name : '',
          file.sku || '',
          file.item_number || '',
        ].filter(Boolean).join(' ');
        const m = smartMatch(debouncedQuery, label, extra);
        if (m) fileHits.push({ manual: file, score: m.score, indices: m.indices, label });
      }
      for (const child of node.children.values()) walk(child);
    }
    walk(tree);

    folderHits.sort((a, b) => a.score - b.score);
    fileHits.sort((a, b) => a.score - b.score);
    return { folderHits, fileHits };
  }, [debouncedQuery, tree]);

  useEffect(() => {
    if (!selectedId) return;
    const file = manuals.find((m) => m.id === selectedId);
    if (!file?.folder_path) return;
    const target = file.folder_path.split('/').map((s) => s.trim()).filter(Boolean);
    setCurrentPath((prev) => (prev.length === 0 ? target : prev));
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

  const currentFolderPath = currentPath.join('/');
  const openRename = useCallback(
    (path: string, count: number) => setRenameFolder({ path, count }),
    [],
  );

  // ─── Background thumbnail backfill ──────────────────────────────────────
  //
  // Walk the files in the current folder and queue any without a thumbnail
  // for client-side generation. Sequential (one at a time) so we don't peg
  // CPU rendering 50 PDFs at once; the loop yields between each file so the
  // UI stays responsive. Skips files we've already attempted in this
  // session (prevents re-queueing on every reload) and bails early if the
  // user navigates to a different folder.
  useEffect(() => {
    if (debouncedQuery) return;                       // search view has different files
    const targets = filesHere.filter(
      (f) => f.source_url && !f.thumbnail_url && !backfillAttemptedRef.current.has(f.id),
    );
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const file of targets) {
        if (cancelled) return;
        backfillAttemptedRef.current.add(file.id);
        try {
          const thumb = await generatePdfThumbnail(file.source_url!);
          if (cancelled || !thumb) continue;
          const form = new FormData();
          form.append('id', String(file.id));
          form.append('thumbnail', new File([thumb.blob], 'thumb.jpg', { type: 'image/jpeg' }));
          const res = await fetch('/api/product-manuals/thumbnail', { method: 'POST', body: form });
          if (cancelled) return;
          if (res.ok) {
            // Optimistically patch the in-memory row so the UI flips to
            // the image without waiting for the next refetch. The next
            // refetch (via manuals-updated) confirms it.
            const json = await res.json().catch(() => ({}));
            if (json?.success && json?.thumbnailUrl) {
              setManuals((prev) =>
                prev.map((m) => (m.id === file.id ? { ...m, thumbnail_url: json.thumbnailUrl } : m)),
              );
            }
          }
        } catch {
          // Best-effort. A failure here means the file stays icon-only
          // until the next session retries it. Worst case the operator
          // opens the manual and the viewer-side backfill kicks in.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [filesHere, debouncedQuery]);

  // ─── Drag-and-drop helpers ──────────────────────────────────────────────
  //
  // Two flows route through the same drop targets (folder rows + the
  // breadcrumb's current folder):
  //   1. Internal — a file row is being dragged. dataTransfer carries the
  //      manual id. Drop = bulk move to that folder.
  //   2. External — the OS file picker dropped one or more PDFs. Drop =
  //      one upload per file, all addressed to the drop-target folder.
  const dropManualIdsOnFolder = useCallback(async (ids: number[], folderPath: string) => {
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/product-manuals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', ids, folderPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
      dispatchManualsUpdated();
      toast.success(`Moved ${data.updated} to ${folderPath || 'root'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Move failed');
    }
  }, []);

  const dropFilesOnFolder = useCallback(async (files: File[], folderPath: string) => {
    if (files.length === 0) return;
    let ok = 0;
    let failed = 0;
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      if (folderPath) form.append('folderPath', folderPath);
      form.append('displayName', file.name.replace(/\.[a-z0-9]+$/i, ''));
      try {
        const res = await fetch('/api/product-manuals/upload', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
        ok++;
      } catch {
        failed++;
      }
    }
    dispatchManualsUpdated();
    if (ok > 0) toast.success(`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'} to ${folderPath || 'root'}`);
    if (failed > 0) toast.error(`${failed} upload${failed === 1 ? '' : 's'} failed`);
  }, []);

  // ─── Bulk operations ─────────────────────────────────────────────────────
  const runBulkMove = useCallback(async () => {
    if (selection.size === 0) return;
    const ids = Array.from(selection);
    setBulkBusy(true);
    try {
      const res = await fetch('/api/product-manuals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', ids, folderPath: moveTarget }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
      dispatchManualsUpdated();
      toast.success(`Moved ${data.updated} ${data.updated === 1 ? 'manual' : 'manuals'} to ${moveTarget || 'root'}`);
      setMoveOpen(false);
      setMoveTarget('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk move failed');
    } finally {
      setBulkBusy(false);
    }
  }, [selection, moveTarget]);

  const runBulkDelete = useCallback(async () => {
    if (selection.size === 0) return;
    const ids = Array.from(selection);
    setBulkBusy(true);
    try {
      const res = await fetch('/api/product-manuals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
      dispatchManualsUpdated();
      const count = data.updated as number;
      toast.success(`Deleted ${count} ${count === 1 ? 'manual' : 'manuals'}`, {
        duration: 10_000,
        action: {
          label: 'Undo',
          onClick: async () => {
            // Bulk restore — flip is_active back on every id at once.
            try {
              const restoreRes = await fetch('/api/product-manuals/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The bulk endpoint's 'update' action doesn't support
                // is_active, so restoration goes through individual PATCHes.
                // For 100 manuals that's 100 requests; fine for an undo
                // path that's measured in seconds and rare in practice.
                body: JSON.stringify({ ids, action: 'restore-noop' }),
              }).catch(() => null);
              void restoreRes; // unused — see comment above
              await Promise.all(
                ids.map((id) =>
                  fetch('/api/product-manuals', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, isActive: true }),
                  }),
                ),
              );
              dispatchManualsUpdated();
              toast.success(`Restored ${ids.length} ${ids.length === 1 ? 'manual' : 'manuals'}`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Restore failed');
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkBusy(false);
    }
  }, [selection]);

  // Whole-sidebar drop catcher — any PDFs dropped on empty space land in
  // the current breadcrumb folder. Folder rows take precedence (their drop
  // handler stops propagation by calling preventDefault first).
  const [sidebarDragOver, setSidebarDragOver] = useState(false);
  const handleSidebarDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!sidebarDragOver) setSidebarDragOver(true);
  };
  const handleSidebarDragLeave = (e: React.DragEvent) => {
    // Ignore bubbled leave events from child rows.
    if (e.currentTarget === e.target) setSidebarDragOver(false);
  };
  const handleSidebarDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setSidebarDragOver(false);
    const filesList = Array.from(e.dataTransfer.files || []);
    if (filesList.length > 0) dropFilesOnFolder(filesList, currentFolderPath);
  };

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col bg-gradient-to-b from-white to-gray-50 ${
        sidebarDragOver ? 'ring-4 ring-indigo-200 ring-inset' : ''
      }`}
      onDragOver={handleSidebarDragOver}
      onDragLeave={handleSidebarDragLeave}
      onDrop={handleSidebarDrop}
    >
      {/* Breadcrumb (only when nested inside a folder, never at root) */}
      {!debouncedQuery && currentPath.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 bg-white/80 px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => goToCrumb(0)}
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
          {/* Rename / move the folder you're currently inside. Sits at the
              end of the breadcrumb so it's easy to find without crowding
              every folder row with an extra control. */}
          <button
            type="button"
            onClick={() => openRename(currentFolderPath, currentNode.totalCount)}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-micro font-black uppercase tracking-wider text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700"
            title="Rename or move this folder"
          >
            <Pencil className="h-3 w-3" />
            Rename
          </button>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : debouncedQuery && searchResults ? (
          <SearchResults
            results={searchResults}
            selectedId={selectedId}
            onSelectFile={handleSelectFile}
            onOpenFolder={(node) => setCurrentPath(node.path)}
            onRenameFolder={openRename}
            selection={selection}
            onToggleSelect={toggleSelected}
            onDropManuals={dropManualIdsOnFolder}
            onDropFiles={dropFilesOnFolder}
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
            onRenameFolder={openRename}
            selection={selection}
            onToggleSelect={toggleSelected}
            onDropManuals={dropManualIdsOnFolder}
            onDropFiles={dropFilesOnFolder}
          />
        )}
      </div>

      {/* Bulk actions bar — slides up from the bottom when 1+ items are
          checked. Anchored above the Upload FAB. Sticks until selection
          is cleared or a bulk op completes (cleared via reloadToken). */}
      {selection.size > 0 && (
        <div className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white shadow-xl shadow-zinc-900/30">
          <span className="text-micro font-black uppercase tracking-[0.16em]">
            {selection.size} selected
          </span>
          <span className="mx-1 h-4 w-px bg-zinc-700" />
          <button
            type="button"
            onClick={() => { setMoveTarget(currentFolderPath); setMoveOpen(true); }}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-micro font-black uppercase tracking-wider text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" />
            Move
          </button>
          <button
            type="button"
            onClick={runBulkDelete}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-micro font-black uppercase tracking-wider text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto inline-flex items-center gap-1 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            title="Clear selection"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Bulk-move modal — a stripped-down sheet with just the folder
          picker, since the only thing the operator picks is "where to". */}
      {moveOpen && (
        <BulkMoveSheet
          count={selection.size}
          target={moveTarget}
          onTargetChange={setMoveTarget}
          busy={bulkBusy}
          onCancel={() => setMoveOpen(false)}
          onConfirm={runBulkMove}
        />
      )}

      {/* Upload FAB — fixed to the sidebar's bottom-right so it's reachable
          from any folder depth. Pre-fills the new manual's folder to the
          current breadcrumb, so "drop a PDF into Sound/Touch" really does
          land it in Sound/Touch. */}
      <button
        type="button"
        onClick={() => setUploadOpen(true)}
        className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2 text-micro font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-blue-600/30 transition-colors hover:bg-blue-700"
        title="Upload a manual"
      >
        <Plus className="h-3.5 w-3.5" />
        Upload
      </button>

      <UploadManualModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        defaultFolderPath={currentFolderPath}
      />

      <RenameFolderModal
        open={!!renameFolder}
        onClose={() => setRenameFolder(null)}
        oldPath={renameFolder?.path || ''}
        fileCount={renameFolder?.count || 0}
      />
    </div>
  );
}

function FolderView({
  subfolders, files, selectedId, onEnter, onSelectFile, onRenameFolder,
  selection, onToggleSelect, onDropManuals, onDropFiles,
}: {
  subfolders: FolderNode[];
  files: ManualRow[];
  selectedId: number | null;
  onEnter: (segment: string) => void;
  onSelectFile: (id: number) => void;
  onRenameFolder: (path: string, count: number) => void;
  selection: Set<number>;
  onToggleSelect: (id: number, additive: boolean) => void;
  onDropManuals: (ids: number[], folderPath: string) => void;
  onDropFiles: (files: File[], folderPath: string) => void;
}) {
  return (
    <div className="space-y-3">
      {subfolders.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Folders · {subfolders.length}
          </p>
          {subfolders.map((node) => (
            <FolderButton
              key={node.name}
              node={node}
              onEnter={() => onEnter(node.name)}
              onRename={() => onRenameFolder(node.path.join('/'), node.totalCount)}
              onDropManuals={(ids) => onDropManuals(ids, node.path.join('/'))}
              onDropFiles={(files) => onDropFiles(files, node.path.join('/'))}
            />
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
              isChecked={selection.has(f.id)}
              onToggleCheck={(additive) => onToggleSelect(f.id, additive)}
              selection={selection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({
  results, selectedId, onSelectFile, onOpenFolder, onRenameFolder,
  selection, onToggleSelect, onDropManuals, onDropFiles,
}: {
  results: {
    folderHits: { node: FolderNode; score: number; indices: number[]; label: string }[];
    fileHits: { manual: ManualRow; score: number; indices: number[]; label: string }[];
  };
  selectedId: number | null;
  onSelectFile: (id: number) => void;
  onOpenFolder: (node: FolderNode) => void;
  onRenameFolder: (path: string, count: number) => void;
  selection: Set<number>;
  onToggleSelect: (id: number, additive: boolean) => void;
  onDropManuals: (ids: number[], folderPath: string) => void;
  onDropFiles: (files: File[], folderPath: string) => void;
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
              onRename={() => onRenameFolder(hit.node.path.join('/'), hit.node.totalCount)}
              onDropManuals={(ids) => onDropManuals(ids, hit.node.path.join('/'))}
              onDropFiles={(files) => onDropFiles(files, hit.node.path.join('/'))}
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
              isChecked={selection.has(hit.manual.id)}
              onToggleCheck={(additive) => onToggleSelect(hit.manual.id, additive)}
              selection={selection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderButton({
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

  // Accept either internal manual drags or external files. The drag-over
  // ring gives operators clear feedback about where the drop will land.
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
      // Refuse a no-op drop (the file's already in this folder) so the
      // toast doesn't fire "Moved 0".
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
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100"
        title="Rename or move folder"
        aria-label={`Rename or move ${node.name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <ChevronRightTiny className="pointer-events-none relative h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" />
    </div>
  );
}

function FileButton({
  manual, isSelected, onClick, highlight, isChecked, onToggleCheck, selection,
}: {
  manual: ManualRow;
  isSelected: boolean;
  onClick: () => void;
  highlight?: { label: string; indices: number[] };
  isChecked: boolean;
  /** additive=true when Cmd/Ctrl/Shift held — preserves prior selection. */
  onToggleCheck: (additive: boolean) => void;
  selection: Set<number>;
}) {
  const title = manual.display_name || manual.file_name || `Manual #${manual.id}`;
  // If the dragged row is in the selection, drop carries every selected id
  // (so dragging one of N checked files moves all N). Otherwise it carries
  // just the single id.
  const handleDragStart = (e: React.DragEvent) => {
    const ids = selection.has(manual.id) ? Array.from(selection) : [manual.id];
    e.dataTransfer.setData('application/x-manual-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    // div outer + button overlay so the checkbox isn't nested inside another button.
    <div
      draggable
      onDragStart={handleDragStart}
      className={`group relative flex w-full items-start gap-2 rounded-2xl border px-3 py-2.5 text-left transition-all ${
        isChecked
          ? 'border-indigo-300 bg-indigo-50/60 shadow-sm ring-1 ring-inset ring-indigo-200'
          : isSelected
            ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/50 shadow-sm ring-1 ring-inset ring-blue-200'
            : 'border-gray-200 bg-white shadow-sm hover:-translate-y-px hover:border-blue-200 hover:bg-blue-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm'
      }`}
    >
      {/* Checkbox on the left — only rendered when the row is in the
          selection set. Entering selection is the pencil's job (right side);
          clicking the checkbox while visible deselects the row. */}
      {isChecked && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(e.metaKey || e.ctrlKey || e.shiftKey);
          }}
          className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-indigo-500 bg-indigo-500 text-white transition-all"
          title="Deselect"
          aria-label={`Deselect ${title}`}
        >
          <Check className="h-3 w-3" />
        </button>
      )}
      <button type="button" onClick={onClick} className="absolute inset-0 rounded-2xl" aria-label={`Open ${title}`} />
      {/* Thumbnail (first page of the PDF) when available, fallback to the
          file-icon glyph for legacy rows that haven't been backfilled yet. */}
      {manual.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={manual.thumbnail_url}
          alt=""
          className={`pointer-events-none relative mt-0.5 h-10 w-8 shrink-0 rounded-md object-cover ring-1 ring-inset ${
            isSelected ? 'ring-blue-200' : 'ring-zinc-200 group-hover:ring-blue-100'
          }`}
        />
      ) : (
        <div
          className={`pointer-events-none relative mt-0.5 flex h-10 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${
            isSelected
              ? 'bg-blue-100 text-blue-600 ring-blue-200'
              : 'bg-gray-50 text-gray-500 ring-gray-200 group-hover:bg-blue-50 group-hover:text-blue-500 group-hover:ring-blue-100'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
        </div>
      )}
      <div className="pointer-events-none relative min-w-0 flex-1">
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
      {/* Selection pencil — the only way into bulk-select. Clicking it adds
          this row to the selection set, which then reveals the checkbox on
          the left (and surfaces the bulk-actions bar at the bottom). Held
          modifiers act additively to mirror normal multi-select semantics. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleCheck(e.metaKey || e.ctrlKey || e.shiftKey);
        }}
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-lg text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100"
        title="Select for bulk action"
        aria-label={`Select ${title} for bulk action`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Bulk-move sheet — opens when the operator clicks "Move" in the bulk
 * action bar. Body is just the FolderPathPicker so we get the search +
 * drill-down + new-folder UI for free.
 *
 * Portals to document.body so the overlay covers the whole viewport (not
 * just the sidebar), matching the Edit / Upload / Rename modals.
 */
function BulkMoveSheet({
  count, target, onTargetChange, busy, onCancel, onConfirm,
}: {
  count: number;
  target: string;
  onTargetChange: (next: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Gate portal until first client render — `document.body` doesn't exist
  // during SSR.
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        onClick={busy ? undefined : onCancel}
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
      />
      <div className="relative z-[111] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20">
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

export default LibraryBrowser;
