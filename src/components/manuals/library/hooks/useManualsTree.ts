'use client';

import { useMemo } from 'react';
import {
  buildTree,
  getNodeAtPath,
  smartMatch,
  type FileHit,
  type FolderHit,
  type FolderNode,
  type ManualRow,
  type SearchResults,
} from '../manuals-tree';

export interface UseManualsTree {
  currentNode: FolderNode;
  /** Non-null only while a search query is active. */
  searchResults: SearchResults | null;
  subfolders: FolderNode[];
  filesHere: ManualRow[];
}

/**
 * Derives the folder tree and the current view (sorted subfolders + files, or
 * the fuzzy search results) from the flat manual rows. Pure memoized
 * computation — re-runs only when the rows, the breadcrumb path, or the
 * debounced query change.
 */
export function useManualsTree(
  manuals: ManualRow[],
  currentPath: string[],
  debouncedQuery: string,
): UseManualsTree {
  const tree = useMemo(() => buildTree(manuals), [manuals]);

  const currentNode = useMemo(
    () => getNodeAtPath(tree, currentPath) ?? tree,
    [tree, currentPath],
  );

  const searchResults = useMemo<SearchResults | null>(() => {
    if (!debouncedQuery) return null;
    const folderHits: FolderHit[] = [];
    const fileHits: FileHit[] = [];

    function walk(node: FolderNode) {
      if (node.path.length > 0) {
        const label = node.name;
        // Full path goes in the extra haystack so "SoundTouch" matches a folder
        // named "Touch" sitting under "Sound".
        const m = smartMatch(debouncedQuery, label, node.path.join(' '));
        if (m) folderHits.push({ node, score: m.score, indices: m.indices, label });
      }
      for (const file of node.files) {
        const label = file.display_name || file.file_name || `Manual #${file.id}`;
        // Everything searchable but not displayed: folder path, product title,
        // the file name (if different), SKU + item number.
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

  return { currentNode, searchResults, subfolders, filesHere };
}
