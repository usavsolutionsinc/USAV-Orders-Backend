'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';

/** A persistent master folder (one row of `photo_folders`). */
export interface PhotoFolder {
  id: number;
  parentId: number | null;
  name: string;
  sortIndex: number;
  /** Photos directly assigned (not counting descendants). */
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoFolderNode extends PhotoFolder {
  children: PhotoFolderNode[];
}

const FOLDERS_KEY = ['photo-folders'] as const;

async function jsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data?.error as string) || 'Request failed');
  return data;
}

/** Build a sorted tree from the flat folder list (orphans surface as roots). */
export function buildFolderTree(folders: PhotoFolder[]): PhotoFolderNode[] {
  const byId = new Map<number, PhotoFolderNode>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [] }));
  const roots: PhotoFolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: PhotoFolderNode[]) => {
    nodes.sort((a, b) => a.sortIndex - b.sortIndex || a.id - b.id);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/**
 * Owns the photo-library master folders: the folder list query + create / rename
 * / move / delete and photo assignment mutations, each invalidating the folder
 * cache (and the photo-library cache when assignments change a folder's contents).
 */
export function usePhotoFolders() {
  const qc = useQueryClient();

  const query = useQuery<PhotoFolder[]>({
    queryKey: FOLDERS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/photos/folders');
      const data = await jsonOrThrow(res);
      return (data.folders ?? []) as PhotoFolder[];
    },
    staleTime: 60_000,
  });

  const folders = useMemo(() => query.data ?? [], [query.data]);
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  const invalidateFolders = () => qc.invalidateQueries({ queryKey: FOLDERS_KEY });
  const invalidateLibrary = () => qc.invalidateQueries({ queryKey: ['photo-library'] });
  const onError = (e: Error) => toast.error(e.message);

  const createFolder = useMutation({
    mutationFn: (input: { name: string; parentId?: number | null }) =>
      fetch('/api/photos/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow),
    onSuccess: () => invalidateFolders(),
    onError,
  });

  const renameFolder = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      fetch(`/api/photos/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(jsonOrThrow),
    onSuccess: () => invalidateFolders(),
    onError,
  });

  const moveFolder = useMutation({
    mutationFn: ({ id, parentId, sortIndex }: { id: number; parentId?: number | null; sortIndex?: number }) =>
      fetch(`/api/photos/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, sortIndex }),
      }).then(jsonOrThrow),
    onSuccess: () => invalidateFolders(),
    onError,
  });

  const deleteFolder = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/photos/folders/${id}`, { method: 'DELETE' }).then(jsonOrThrow),
    onSuccess: () => {
      invalidateFolders();
      invalidateLibrary();
    },
    onError,
  });

  // Optimistically reflow sort_index so a drag-reorder feels instant; roll back
  // on error and reconcile with the server on settle.
  const reorderFolders = useMutation({
    mutationFn: (items: Array<{ id: number; sortIndex: number }>) =>
      fetch('/api/photos/folders/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      }).then(jsonOrThrow),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: FOLDERS_KEY });
      const prev = qc.getQueryData<PhotoFolder[]>(FOLDERS_KEY);
      if (prev) {
        const next = new Map(items.map((i) => [i.id, i.sortIndex]));
        qc.setQueryData<PhotoFolder[]>(
          FOLDERS_KEY,
          prev.map((f) => (next.has(f.id) ? { ...f, sortIndex: next.get(f.id)! } : f)),
        );
      }
      return { prev };
    },
    onError: (e: Error, _items, context) => {
      if (context?.prev) qc.setQueryData(FOLDERS_KEY, context.prev);
      onError(e);
    },
    onSettled: () => invalidateFolders(),
  });

  const addPhotos = useMutation({
    mutationFn: ({ folderId, photoIds }: { folderId: number; photoIds: number[] }) =>
      fetch(`/api/photos/folders/${folderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds }),
      }).then(jsonOrThrow),
    onSuccess: (data: { added?: number }) => {
      invalidateFolders();
      invalidateLibrary();
      const n = data?.added ?? 0;
      toast.success(n > 0 ? `Added ${n} photo${n === 1 ? '' : 's'} to folder` : 'Already in folder');
    },
    onError,
  });

  const removePhotos = useMutation({
    mutationFn: ({ folderId, photoIds }: { folderId: number; photoIds: number[] }) =>
      fetch(`/api/photos/folders/${folderId}/items`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds }),
      }).then(jsonOrThrow),
    onSuccess: () => {
      invalidateFolders();
      invalidateLibrary();
    },
    onError,
  });

  return {
    folders,
    tree,
    isLoading: query.isLoading,
    createFolder,
    renameFolder,
    moveFolder,
    reorderFolders,
    deleteFolder,
    addPhotos,
    removePhotos,
  };
}
