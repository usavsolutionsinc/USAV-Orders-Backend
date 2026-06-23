'use client';

import { useState } from 'react';
import { ChevronRight, Folder, Loader2, Pencil, Plus, Trash2 } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { usePhotoFolders, type PhotoFolderNode } from '@/hooks/usePhotoFolders';

interface PhotoFolderTreeProps {
  /** Currently-filtered folder (photo_folders.id), or null for "no folder filter". */
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
}

/**
 * Sidebar master-folder tree with full CRUD. Operator-created folders are
 * persistent (org-scoped) and nestable; clicking a folder filters the grid to
 * its assigned photos, clicking the selected one clears the filter. Create /
 * rename / delete / add-subfolder use lightweight prompt/confirm dialogs — no
 * bespoke modal — consistent with the library's other destructive confirms.
 */
export function PhotoFolderTree({ selectedFolderId, onSelectFolder }: PhotoFolderTreeProps) {
  const { tree, folders, isLoading, createFolder, renameFolder, deleteFolder, reorderFolders } =
    usePhotoFolders();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Drag-to-reorder among siblings. `dragId` is the folder being dragged;
  // `overId` is the row currently hovered (drawn with an insert-before line).
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  /** Reorder the dragged folder to sit immediately before `targetId` (same parent only). */
  const dropOn = (targetId: number) => {
    const dragged = folders.find((f) => f.id === dragId);
    const target = folders.find((f) => f.id === targetId);
    setDragId(null);
    setOverId(null);
    if (!dragged || !target || dragged.id === target.id) return;
    if (dragged.parentId !== target.parentId) return; // same-level reorder only
    const siblings = folders
      .filter((f) => f.parentId === dragged.parentId && f.id !== dragged.id)
      .sort((a, b) => a.sortIndex - b.sortIndex || a.id - b.id);
    const insertAt = siblings.findIndex((f) => f.id === target.id);
    siblings.splice(insertAt < 0 ? siblings.length : insertAt, 0, dragged);
    const items = siblings.map((f, i) => ({ id: f.id, sortIndex: i }));
    reorderFolders.mutate(items);
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const promptCreate = (parentId: number | null) => {
    const name = window.prompt(parentId ? 'New subfolder name' : 'New folder name')?.trim();
    if (name) createFolder.mutate({ name, parentId });
    if (name && parentId != null) setExpanded((prev) => new Set(prev).add(parentId));
  };

  const promptRename = (id: number, current: string) => {
    const name = window.prompt('Rename folder', current)?.trim();
    if (name && name !== current) renameFolder.mutate({ id, name });
  };

  const confirmDelete = (node: PhotoFolderNode) => {
    const photos = node.photoCount > 0 ? ` and unfile its ${node.photoCount} photo${node.photoCount === 1 ? '' : 's'}` : '';
    const subs = node.children.length > 0 ? ` and ${node.children.length} subfolder${node.children.length === 1 ? '' : 's'}` : '';
    if (window.confirm(`Delete "${node.name}"${subs}${photos}? Photos themselves are not deleted.`)) {
      if (selectedFolderId === node.id) onSelectFolder(null);
      deleteFolder.mutate(node.id);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-micro font-black uppercase tracking-wider text-gray-400">Folders</span>
        <button
          type="button"
          onClick={() => promptCreate(null)}
          title="New folder"
          aria-label="New folder"
          className="-my-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-2 py-2 text-micro text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : tree.length === 0 ? (
        <button
          type="button"
          onClick={() => promptCreate(null)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-micro font-bold uppercase tracking-wider text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
        >
          <Plus className="h-3.5 w-3.5" /> New folder
        </button>
      ) : (
        <ul className="space-y-0.5">
          {tree.map((node) => (
            <FolderRow
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onCreateSub={promptCreate}
              onRename={promptRename}
              onDelete={confirmDelete}
              dragId={dragId}
              overId={overId}
              onDragStart={setDragId}
              onDragOver={setOverId}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDrop={dropOn}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FolderRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedFolderId,
  onSelectFolder,
  onCreateSub,
  onRename,
  onDelete,
  dragId,
  overId,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  node: PhotoFolderNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onCreateSub: (parentId: number | null) => void;
  onRename: (id: number, current: string) => void;
  onDelete: (node: PhotoFolderNode) => void;
  dragId: number | null;
  overId: number | null;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDragEnd: () => void;
  onDrop: (id: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const selected = selectedFolderId === node.id;
  // Only siblings (same parent) are valid drop targets; mark the insert line.
  const isDropTarget = dragId != null && overId === node.id && dragId !== node.id;

  return (
    <li>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(node.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver(node.id);
        }}
        onDragEnd={onDragEnd}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDrop(node.id);
        }}
        className={cn(
          'group relative flex items-center gap-1 rounded-lg pr-1 transition-colors',
          dragId === node.id && 'opacity-40',
          selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-50',
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {isDropTarget ? (
          <span
            className="pointer-events-none absolute inset-x-1 top-0 h-0.5 -translate-y-px rounded-full bg-blue-400"
            aria-hidden="true"
          />
        ) : null}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-700"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => onSelectFolder(selected ? null : node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
        >
          <Folder className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-blue-600' : 'text-gray-400')} />
          <span className={cn('truncate text-sm font-semibold', selected ? 'text-blue-900' : 'text-gray-700')}>
            {node.name}
          </span>
          {node.photoCount > 0 ? (
            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-500">
              {node.photoCount}
            </span>
          ) : null}
        </button>

        <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconBtn label="New subfolder" onClick={() => onCreateSub(node.id)}><Plus className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Rename" onClick={() => onRename(node.id, node.name)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Delete" tone="rose" onClick={() => onDelete(node)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </span>
      </div>

      {hasChildren && isOpen ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onCreateSub={onCreateSub}
              onRename={onRename}
              onDelete={onDelete}
              dragId={dragId}
              overId={overId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function IconBtn({
  label,
  onClick,
  tone = 'gray',
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'gray' | 'rose';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        tone === 'rose'
          ? 'text-gray-400 hover:bg-rose-50 hover:text-rose-600'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}
