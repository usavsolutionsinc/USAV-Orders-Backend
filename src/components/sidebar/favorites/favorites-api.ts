import type { FavoriteSkuRecord, FavoriteWorkspaceKey } from '@/lib/favorites/sku-favorites';
import type { EcwidSearchProduct } from './favorites-search';

/** Pure network layer for the favorites workspace. Throws with server messages. */

export async function fetchFavorites(workspaceKey: FavoriteWorkspaceKey): Promise<FavoriteSkuRecord[]> {
  const res = await fetch(`/api/favorites?workspace=${encodeURIComponent(workspaceKey)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to load favorites');
  return Array.isArray(data?.favorites) ? data.favorites : [];
}

export async function searchEcwidProducts(query: string, limit: number, signal: AbortSignal): Promise<EcwidSearchProduct[]> {
  const res = await fetch(`/api/ecwid/products/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to search products');
  return Array.isArray(data?.products) ? (data.products as EcwidSearchProduct[]) : [];
}

export async function saveFavorite(payload: Record<string, unknown>, editingFavoriteId: number | null): Promise<void> {
  const isEditing = editingFavoriteId !== null;
  const res = await fetch(isEditing ? `/api/favorites/${editingFavoriteId}` : '/api/favorites', {
    method: isEditing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.details || data?.error || (isEditing ? 'Failed to update favorite' : 'Failed to create favorite'));
  }
}

export async function deleteFavorite(favoriteId: number, workspaceKey: FavoriteWorkspaceKey): Promise<void> {
  const res = await fetch(`/api/favorites/${favoriteId}?workspace=${encodeURIComponent(workspaceKey)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to delete favorite');
}
