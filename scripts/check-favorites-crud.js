#!/usr/bin/env node

require('dotenv').config({ path: '.env', quiet: true });

const baseUrl = process.env.FAVORITES_TEST_BASE_URL || 'http://127.0.0.1:3000';
const workspaceKey = 'sku-stock';
const randomKey = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log(`Checking favorites CRUD against ${baseUrl}`);

  const created = await request('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceKey,
      ecwidProductId: `ecwid-${randomKey}`,
      sku: `TEST-SKU-${randomKey}`,
      label: `Favorites CRUD ${randomKey}`,
      productTitle: `CRUD Product ${randomKey}`,
      defaultPrice: '12.34',
      notes: 'temporary favorites CRUD check',
    }),
  });

  const favoriteId = created?.favorite?.id;
  if (!favoriteId) {
    throw new Error('Create did not return favorite.id');
  }
  console.log(`Created favorite ${favoriteId}`);

  const listed = await request(`/api/favorites?workspace=${encodeURIComponent(workspaceKey)}`);
  const foundCreated = Array.isArray(listed?.favorites)
    ? listed.favorites.find((favorite) => favorite.id === favoriteId)
    : null;
  if (!foundCreated) {
    throw new Error('Created favorite not found in list response');
  }
  console.log('List returned created favorite');

  const updatedLabel = `Favorites CRUD Updated ${randomKey}`;
  const updated = await request(`/api/favorites/${favoriteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceKey,
      label: updatedLabel,
    }),
  });

  if (updated?.favorite?.label !== updatedLabel) {
    throw new Error('Update did not persist new label');
  }
  console.log('Update returned new label');

  await request(`/api/favorites/${favoriteId}?workspace=${encodeURIComponent(workspaceKey)}`, {
    method: 'DELETE',
  });
  console.log('Delete succeeded');

  const listedAfterDelete = await request(`/api/favorites?workspace=${encodeURIComponent(workspaceKey)}`);
  const foundAfterDelete = Array.isArray(listedAfterDelete?.favorites)
    ? listedAfterDelete.favorites.find((favorite) => favorite.id === favoriteId)
    : null;
  if (foundAfterDelete) {
    throw new Error('Deleted favorite still present in list response');
  }
  console.log('CRUD check passed');
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
