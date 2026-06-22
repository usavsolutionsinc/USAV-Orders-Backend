'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  buildTree,
  fuzzyMatch,
  getNodeAtPath,
  type FileHit,
  type FolderHit,
  type FolderNode,
  type ManualRow,
  type SearchResultsData,
  type StatusFilter,
} from './manuals-library-shared';

/**
 * Owns the manuals library sidebar: status-filtered fetch over the full dataset,
 * the debounced query + URL deep-link sync, the folder-tree build, fuzzy search
 * (folders + files), folder breadcrumb navigation, and the deep-link
 * auto-navigate to the selected file's folder. Returns a controller bag the thin
 * shell renders from.
 */
export function useManualsLibrary() {
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
  const searchResults = useMemo<SearchResultsData | null>(() => {
    if (!debouncedQuery) return null;
    const folderHits: FolderHit[] = [];
    const fileHits: FileHit[] = [];

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

  return {
    selectedId,
    query, setQuery,
    status, setStatus,
    loading,
    debouncedQuery,
    currentPath, setCurrentPath,
    tree, currentNode,
    searchResults,
    subfolders, filesHere,
    handleSelectFile, enterFolder, goToCrumb, handleClear, handleModeChange,
  };
}
