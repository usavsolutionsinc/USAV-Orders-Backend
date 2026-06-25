'use client';

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

/**
 * Generic image dropzone — drag-drop OR click-to-pick image files. Shared by the
 * Zendesk claim modal and the support chat composer so both get identical
 * "drop photos here" behaviour. Filters to image/* and ignores internal app
 * drags (which set their own dataTransfer types, not `Files`).
 *
 * Usage:
 *   const dz = usePhotoDropzone((files) => addFiles(files));
 *   <div {...dz.rootProps}> … </div>
 *   <button onClick={dz.openPicker}>Add photos</button>
 *   <input {...dz.inputProps} />
 */
export interface UsePhotoDropzone {
  isDragging: boolean;
  rootProps: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  /** Callback ref for the hidden <input> ({@link inputProps} carries the rest). */
  inputRef: (el: HTMLInputElement | null) => void;
  inputProps: {
    type: 'file';
    accept: string;
    multiple: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    className: string;
  };
  openPicker: () => void;
}

const isFileDrag = (e: DragEvent): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function usePhotoDropzone(
  onFiles: (files: File[]) => void,
  opts: { accept?: string; multiple?: boolean } = {},
): UsePhotoDropzone {
  const { accept = 'image/*', multiple = true } = opts;
  const elRef = useRef<HTMLInputElement | null>(null);
  // Callback ref — assignable to <input ref> across React 18/19 typings, unlike
  // a RefObject<HTMLInputElement | null> which trips LegacyRef variance.
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    elRef.current = el;
  }, []);
  // Counter, not a boolean — nested children fire dragenter/leave so a plain flag
  // flickers. Increment on enter, decrement on leave; dragging = depth > 0.
  const depth = useRef(0);
  const [isDragging, setDragging] = useState(false);

  const acceptFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      acceptFiles(e.dataTransfer.files);
    },
    [acceptFiles],
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      acceptFiles(e.target.files);
      // Reset so picking the same file twice still fires onChange.
      e.target.value = '';
    },
    [acceptFiles],
  );

  const openPicker = useCallback(() => elRef.current?.click(), []);

  return {
    isDragging,
    rootProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    inputRef,
    inputProps: { type: 'file', accept, multiple, onChange, className: 'hidden' },
    openPicker,
  };
}
