/**
 * Pure data layer for the manuals/library browser: the row shape, the folder
 * tree builder, and the path-aware fuzzy matcher. No React — independently
 * testable.
 */

export interface ManualRow {
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

export interface FolderNode {
  name: string;
  path: string[];
  files: ManualRow[];
  children: Map<string, FolderNode>;
  totalCount: number;
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'unassigned': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'assigned':   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'archived':   return 'bg-surface-sunken text-text-soft border-border-soft';
    default:           return 'bg-surface-canvas text-text-muted border-border-soft';
  }
}

export function typeBadgeClass(type: string | null): string {
  switch ((type || '').toLowerCase()) {
    case 'manual':       return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'packing-list': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'pl-plus-m':    return 'bg-violet-50 text-violet-700 border-violet-200';
    default:             return 'bg-surface-canvas text-text-muted border-border-soft';
  }
}

/** Build a nested folder tree from the flat manual rows (split on `/`). */
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

/** Lowercase + strip non-alphanumerics so separators become invisible. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Path-aware normalized matcher. Normalizing both sides lets a query like
 * "SoundTouch" match a file at `Sound/Touch/Bose SoundTouch 30 Manual`.
 *
 * `displayLabel` is the row text (used for the highlight char map); the score
 * prefers label-internal hits, then earlier positions, then shorter haystacks.
 * Returns null when the query appears nowhere; an empty needle returns score 0.
 */
export function smartMatch(
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

  // Build highlight indices against the ORIGINAL display label by mapping each
  // surviving (alphanumeric) char back to its source position.
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

/** A folder/file search hit with its score, highlight indices, and label. */
export interface FolderHit { node: FolderNode; score: number; indices: number[]; label: string }
export interface FileHit { manual: ManualRow; score: number; indices: number[]; label: string }
export interface SearchResults { folderHits: FolderHit[]; fileHits: FileHit[] }
