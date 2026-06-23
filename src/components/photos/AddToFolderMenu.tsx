'use client';

import { useMemo, useState } from 'react';
import { Folder, Plus } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { usePhotoFolders, type PhotoFolderNode } from '@/hooks/usePhotoFolders';

/** Flatten the folder tree to a depth-tagged list for an indented flat menu. */
function flattenTree(nodes: PhotoFolderNode[], depth = 0): Array<{ id: number; name: string; depth: number }> {
  return nodes.flatMap((n) => [
    { id: n.id, name: n.name, depth },
    ...flattenTree(n.children, depth + 1),
  ]);
}

/**
 * "Add to folder" control for the selection toolbar — drops the selected photos
 * into a master folder, or creates a new folder and adds them in one step.
 * Assignment is idempotent server-side, so re-adding is a no-op.
 */
export function AddToFolderMenu({ photoIds }: { photoIds: number[] }) {
  const { tree, createFolder, addPhotos } = usePhotoFolders();
  const [open, setOpen] = useState(false);
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const disabled = photoIds.length === 0;

  const addTo = (folderId: number) => {
    addPhotos.mutate({ folderId, photoIds });
    setOpen(false);
  };

  const createAndAdd = async () => {
    const name = window.prompt('New folder name')?.trim();
    if (!name) return;
    try {
      const data = (await createFolder.mutateAsync({ name })) as { folder?: { id?: number } };
      const id = data?.folder?.id;
      if (id) addPhotos.mutate({ folderId: id, photoIds });
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40"
      >
        <Folder className="h-4 w-4" />
        <span className="hidden sm:inline">Add to folder</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
            <button
              type="button"
              onClick={createAndAdd}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
            >
              <Plus className="h-3.5 w-3.5" /> New folder…
            </button>
            {flat.length > 0 ? <div className="my-1 border-t border-gray-100" /> : null}
            {flat.length === 0 ? (
              <p className="px-2 py-2 text-micro text-gray-400">No folders yet</p>
            ) : (
              flat.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => addTo(f.id)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50',
                  )}
                  style={{ paddingLeft: `${8 + f.depth * 14}px` }}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
