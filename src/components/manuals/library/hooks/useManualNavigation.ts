'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ManualRow } from '../manuals-tree';

export interface UseManualNavigation {
  /** Currently selected file id (from `?id=`), or null. */
  selectedId: number | null;
  currentPath: string[];
  setCurrentPath: React.Dispatch<React.SetStateAction<string[]>>;
  currentFolderPath: string;
  /** Write `?id=` on basePath to open a file in the right pane. */
  handleSelectFile: (id: number) => void;
  enterFolder: (segment: string) => void;
  goToCrumb: (index: number) => void;
}

/**
 * Owns folder navigation: the breadcrumb path, drilling in/out, and the
 * `?id=`-driven file selection. When a file is selected directly (deep link),
 * the breadcrumb jumps to that file's folder once.
 *
 * @param basePath Route for URL writes (e.g. '/products').
 * @param manuals  Current rows — used to resolve a deep-linked file's folder.
 */
export function useManualNavigation(basePath: string, manuals: ManualRow[]): UseManualNavigation {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;

  const [currentPath, setCurrentPath] = useState<string[]>([]);

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

  // Deep link to a file: jump the breadcrumb to its folder (once, when at root).
  useEffect(() => {
    if (!selectedId) return;
    const file = manuals.find((m) => m.id === selectedId);
    if (!file?.folder_path) return;
    const target = file.folder_path.split('/').map((s) => s.trim()).filter(Boolean);
    setCurrentPath((prev) => (prev.length === 0 ? target : prev));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    selectedId,
    currentPath,
    setCurrentPath,
    currentFolderPath: currentPath.join('/'),
    handleSelectFile,
    enterFolder,
    goToCrumb,
  };
}
