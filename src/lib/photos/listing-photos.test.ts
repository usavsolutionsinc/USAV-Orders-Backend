import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getListingGallery,
  addPhotosToListing,
  reorderListing,
  setListingCover,
  removeFromListing,
  ListingTargetError,
  type ListingPhotoDeps,
} from '@/lib/photos/listing-photos';

const ORG = '00000000-0000-0000-0000-000000000001';

interface Call {
  sql: string;
  params: unknown[];
}

function fakes(respond: (sql: string, params: unknown[]) => { rows?: unknown[] }) {
  const calls: Call[] = [];
  const run = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const r = respond(sql, params);
    return { rows: r.rows ?? [], rowCount: r.rows?.length ?? 0 };
  };
  const client = { query: run };
  const deps = {
    tenantQuery: async (_o: string, sql: string, params: unknown[] = []) => run(sql, params),
    withTenantTransaction: async (_o: string, cb: (c: typeof client) => Promise<unknown>) => cb(client),
  } as unknown as ListingPhotoDeps;
  return { deps, calls };
}

const gRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  photo_id: 100,
  sort_order: 0,
  is_cover: false,
  created_at: '2026-06-26T00:00:00Z',
  ...over,
});

test('getListingGallery rejects an invalid target id', async () => {
  const { deps } = fakes(() => ({ rows: [] }));
  await assert.rejects(() => getListingGallery(ORG, { kind: 'sku', id: 0 }, deps), ListingTargetError);
});

test('getListingGallery queries by the SKU column and maps rows', async () => {
  const { deps, calls } = fakes(() => ({ rows: [gRow({ is_cover: true }), gRow({ id: 2, photo_id: 101, sort_order: 1 })] }));
  const items = await getListingGallery(ORG, { kind: 'sku', id: 42 }, deps);
  assert.equal(items.length, 2);
  assert.equal(items[0].isCover, true);
  assert.ok(calls[0].sql.includes('sku_catalog_id = $2'), 'filters on the sku column');
  assert.deepEqual(calls[0].params, [ORG, 42]);
});

test('getListingGallery uses the unit column for a unit target', async () => {
  const { deps, calls } = fakes(() => ({ rows: [] }));
  await getListingGallery(ORG, { kind: 'unit', id: 7 }, deps);
  assert.ok(calls[0].sql.includes('serial_unit_id = $2'), 'filters on the unit column');
});

test('addPhotosToListing stamps the first photo of an empty gallery as cover', async () => {
  const { deps, calls } = fakes((sql) => {
    if (sql.includes('COALESCE(MAX(sort_order)')) return { rows: [{ next: 0, count: 0 }] }; // empty gallery
    if (sql.startsWith('SELECT id, photo_id')) return { rows: [gRow({ is_cover: true })] };
    return { rows: [] };
  });
  await addPhotosToListing(ORG, { kind: 'sku', id: 42 }, [100, 101], {}, deps);
  const insert = calls.find((c) => c.sql.includes('INSERT INTO listing_photos'))!;
  assert.ok(insert, 'an INSERT ran');
  // $7 is the wasEmpty flag → first inserted row becomes cover.
  assert.equal(insert.params[6], true, 'wasEmpty flag set for an empty gallery');
  assert.deepEqual(insert.params[3], [100, 101], 'photo ids passed as an array');
});

test('addPhotosToListing does not mark a cover when the gallery already has photos', async () => {
  const { deps, calls } = fakes((sql) => {
    if (sql.includes('COALESCE(MAX(sort_order)')) return { rows: [{ next: 3, count: 3 }] }; // non-empty
    if (sql.startsWith('SELECT id, photo_id')) return { rows: [] };
    return { rows: [] };
  });
  await addPhotosToListing(ORG, { kind: 'sku', id: 42 }, [200], {}, deps);
  const insert = calls.find((c) => c.sql.includes('INSERT INTO listing_photos'))!;
  assert.equal(insert.params[6], false, 'wasEmpty is false → no auto-cover');
  assert.equal(insert.params[2], 3, 'new rows start after the current max sort_order');
});

test('addPhotosToListing with no photo ids skips the insert', async () => {
  const { deps, calls } = fakes(() => ({ rows: [] }));
  await addPhotosToListing(ORG, { kind: 'sku', id: 42 }, [], {}, deps);
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO listing_photos')), 'no INSERT for empty input');
});

test('reorderListing writes the supplied order via ordinality', async () => {
  const { deps, calls } = fakes((sql) => (sql.startsWith('SELECT id, photo_id') ? { rows: [] } : { rows: [] }));
  await reorderListing(ORG, { kind: 'sku', id: 42 }, [103, 101, 102], deps);
  const update = calls.find((c) => c.sql.includes('SET sort_order = v.ord'))!;
  assert.ok(update, 'a reorder UPDATE ran');
  assert.deepEqual(update.params[2], [103, 101, 102], 'order array threaded for ORDINALITY');
});

test('setListingCover clears the old cover before setting the new one', async () => {
  const order: string[] = [];
  const { deps } = fakes((sql) => {
    if (sql.includes('SET is_cover = FALSE')) order.push('clear');
    if (sql.includes('SET is_cover = TRUE')) order.push('set');
    return { rows: [] };
  });
  await setListingCover(ORG, { kind: 'sku', id: 42 }, 101, deps);
  assert.deepEqual(order, ['clear', 'set'], 'clear must precede set (partial-unique safe)');
});

test('setListingCover validates the photo id', async () => {
  const { deps } = fakes(() => ({ rows: [] }));
  await assert.rejects(() => setListingCover(ORG, { kind: 'sku', id: 42 }, 0, deps), ListingTargetError);
});

test('removeFromListing promotes a new cover when the removed photo was the cover', async () => {
  const sqls: string[] = [];
  const { deps } = fakes((sql) => {
    sqls.push(sql);
    if (sql.includes('DELETE FROM listing_photos')) return { rows: [{ is_cover: true }] }; // removed the cover
    return { rows: [] };
  });
  await removeFromListing(ORG, { kind: 'sku', id: 42 }, 100, deps);
  assert.ok(
    sqls.some((s) => s.includes('SET is_cover = TRUE')),
    'a replacement cover is promoted after removing the cover',
  );
});

test('removeFromListing does not promote when a non-cover photo is removed', async () => {
  const sqls: string[] = [];
  const { deps } = fakes((sql) => {
    sqls.push(sql);
    if (sql.includes('DELETE FROM listing_photos')) return { rows: [{ is_cover: false }] };
    return { rows: [] };
  });
  await removeFromListing(ORG, { kind: 'sku', id: 42 }, 100, deps);
  assert.ok(!sqls.some((s) => s.includes('SET is_cover = TRUE')), 'no cover promotion needed');
});
