import { type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

export type StatusFilter = 'all' | 'unassigned' | 'assigned' | 'archived';

export interface ManualRow {
  id: number;
  product_title: string | null;
  display_name: string | null;
  source_url: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: string;
  type: string | null;
}

export const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', tone: 'zinc' },
  { id: 'pairing', label: 'SKU Pairing', tone: 'orange' },
  { id: 'manuals', label: 'Manuals', tone: 'emerald' },
  { id: 'qc', label: 'QC Checklist', tone: 'blue' },
  { id: 'library', label: 'Library', tone: 'purple' },
];

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',        label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'assigned',   label: 'Assigned' },
  { value: 'archived',   label: 'Archived' },
];

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'unassigned': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'assigned':   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'archived':   return 'bg-gray-100 text-gray-500 border-gray-200';
    default:           return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

export function typeBadgeClass(type: string | null): string {
  switch ((type || '').toLowerCase()) {
    case 'manual':          return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'troubleshooting': return 'bg-red-50 text-red-700 border-red-200';
    case 'installation':    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'quick-start':     return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'safety':          return 'bg-orange-50 text-orange-700 border-orange-200';
    default:                return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

// ─── Folder tree types ──────────────────────────────────────────────────────
export interface FolderNode {
  name: string;          // this segment, e.g. "Lifestyle"
  path: string[];        // segments from root, e.g. ["Systems", "Surround", "Lifestyle"]
  files: ManualRow[];    // files directly in this folder
  children: Map<string, FolderNode>;
  totalCount: number;    // total files in this folder and all descendants
}

export function buildTree(manuals: ManualRow[]): FolderNode {
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
  // Compute total descendant counts in one DFS pass
  function compute(n: FolderNode): number {
    let count = n.files.length;
    for (const child of n.children.values()) count += compute(child);
    n.totalCount = count;
    return count;
  }
  compute(root);
  return root;
}

export function getNodeAtPath(root: FolderNode, path: string[]): FolderNode | null {
  let node = root;
  for (const seg of path) {
    const next = node.children.get(seg);
    if (!next) return null;
    node = next;
  }
  return node;
}

// ─── Fuzzy match ────────────────────────────────────────────────────────────
// Returns null if no match, otherwise a score (lower = better) plus match
// indices for highlighting. Sublime-style: all chars of needle appear in
// order; consecutive matches score better; matches at start of word score
// better.
export function fuzzyMatch(needle: string, haystack: string): { score: number; indices: number[] } | null {
  if (!needle) return { score: 0, indices: [] };
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let lastIdx = -1;
  let consecutive = 0;
  let nIdx = 0;
  for (let i = 0; i < h.length && nIdx < n.length; i++) {
    if (h[i] === n[nIdx]) {
      indices.push(i);
      const gap = lastIdx === -1 ? 0 : i - lastIdx - 1;
      score += gap;
      // Reward matches at word boundaries
      const atBoundary = i === 0 || /[\s/\-_:.()]/.test(h[i - 1]);
      if (atBoundary) score -= 2;
      if (gap === 0) consecutive++;
      else consecutive = 0;
      score -= consecutive;
      lastIdx = i;
      nIdx++;
    }
  }
  if (nIdx < n.length) return null;
  // Prefer shorter haystacks
  score += haystack.length * 0.01;
  return { score, indices };
}

// ─── Search result shapes ─────────────────────────────────────────────────
export interface FolderHit { node: FolderNode; score: number; indices: number[]; label: string }
export interface FileHit { manual: ManualRow; score: number; indices: number[]; label: string }
export interface SearchResultsData { folderHits: FolderHit[]; fileHits: FileHit[] }
