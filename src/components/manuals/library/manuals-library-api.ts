import type { ManualRow } from './manuals-tree';

/**
 * Pure network layer for the manuals library. No React/toast — each function
 * hits an endpoint and returns a normalized result (or throws), so hooks own
 * the toast/state orchestration.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Load the full manual list (server-capped at 1000). Empty array on failure. */
export async function fetchManuals(): Promise<ManualRow[]> {
  const res = await fetch(`/api/product-manuals/search?limit=1000`, { cache: 'no-store' });
  const data = await res.json();
  return data?.success ? data.manuals || [] : [];
}

/** Bulk-move manuals to a folder. Throws on failure. */
export async function bulkMoveManuals(ids: number[], folderPath: string): Promise<{ updated: number }> {
  const res = await fetch('/api/product-manuals/bulk', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action: 'move', ids, folderPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
  return { updated: data.updated as number };
}

/** Bulk soft-delete manuals. Throws on failure. */
export async function bulkDeleteManuals(ids: number[]): Promise<{ updated: number }> {
  const res = await fetch('/api/product-manuals/bulk', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action: 'delete', ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
  return { updated: data.updated as number };
}

/**
 * Restore (un-delete) manuals by flipping is_active back on, one PATCH per id.
 * The bulk endpoint's 'update' action doesn't support is_active, so this is
 * intentionally N requests — fine for a rare, seconds-scale undo path.
 */
export async function restoreManuals(ids: number[]): Promise<void> {
  await Promise.all(
    ids.map((id) =>
      fetch('/api/product-manuals', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id, isActive: true }),
      }),
    ),
  );
}

/** Upload one PDF to a folder. Throws on failure. */
export async function uploadManualFile(file: File, folderPath: string): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  if (folderPath) form.append('folderPath', folderPath);
  form.append('displayName', file.name.replace(/\.[a-z0-9]+$/i, ''));
  const res = await fetch('/api/product-manuals/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
}

/**
 * Persist a generated thumbnail for a manual. Returns the new thumbnail URL on
 * success, or null (best-effort — the row stays icon-only until next session).
 */
export async function saveManualThumbnail(id: number, blob: Blob): Promise<string | null> {
  const form = new FormData();
  form.append('id', String(id));
  form.append('thumbnail', new File([blob], 'thumb.jpg', { type: 'image/jpeg' }));
  const res = await fetch('/api/product-manuals/thumbnail', { method: 'POST', body: form });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json?.success && json?.thumbnailUrl ? (json.thumbnailUrl as string) : null;
}
