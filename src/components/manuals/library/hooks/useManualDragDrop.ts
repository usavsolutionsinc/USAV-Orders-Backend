'use client';

import { useCallback, useState } from 'react';
import { toast } from '@/lib/toast';
import { dispatchManualsUpdated } from '../../ManualCrudModals';
import { bulkMoveManuals, uploadManualFile } from '../manuals-library-api';

export interface UseManualDragDrop {
  /** Move dragged manual rows into a folder (internal drag). */
  dropManualIdsOnFolder: (ids: number[], folderPath: string) => Promise<void>;
  /** Upload OS-dropped PDFs into a folder (one request per file). */
  dropFilesOnFolder: (files: File[], folderPath: string) => Promise<void>;
  /** True while a file is dragged over the sidebar background. */
  sidebarDragOver: boolean;
  handleSidebarDragOver: (e: React.DragEvent) => void;
  handleSidebarDragLeave: (e: React.DragEvent) => void;
  handleSidebarDrop: (e: React.DragEvent) => void;
}

/**
 * Drag-and-drop coordination for the library. Two flows share the same folder
 * drop targets: internal manual-row moves (carry the id) and external OS-file
 * uploads (one upload per dropped PDF, all addressed to the target folder). Also
 * owns the whole-sidebar drop catcher that routes loose drops to the current
 * breadcrumb folder.
 *
 * @param currentFolderPath The breadcrumb folder loose drops land in.
 */
export function useManualDragDrop(currentFolderPath: string): UseManualDragDrop {
  const dropManualIdsOnFolder = useCallback(async (ids: number[], folderPath: string) => {
    if (ids.length === 0) return;
    try {
      const { updated } = await bulkMoveManuals(ids, folderPath);
      dispatchManualsUpdated();
      toast.success(`Moved ${updated} to ${folderPath || 'root'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Move failed');
    }
  }, []);

  const dropFilesOnFolder = useCallback(async (files: File[], folderPath: string) => {
    if (files.length === 0) return;
    let ok = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await uploadManualFile(file, folderPath);
        ok++;
      } catch {
        failed++;
      }
    }
    dispatchManualsUpdated();
    if (ok > 0) toast.success(`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'} to ${folderPath || 'root'}`);
    if (failed > 0) toast.error(`${failed} upload${failed === 1 ? '' : 's'} failed`);
  }, []);

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

  return {
    dropManualIdsOnFolder,
    dropFilesOnFolder,
    sidebarDragOver,
    handleSidebarDragOver,
    handleSidebarDragLeave,
    handleSidebarDrop,
  };
}
