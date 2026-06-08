import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { getAccessToken, getInventoryBaseUrl, requireOrgId } from '@/lib/zoho/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/items/[id]/image
 *
 * Serves a Zoho item photo, where [id] is the `zoho_item_id`. Zoho's items API
 * exposes only `image_document_id` (captured during sync), not a URL — the bytes
 * must be fetched from GET /inventory/v1/items/{id}/image. We fetch once, cache
 * the bytes in `zoho_item_images`, and re-fetch only when the document id changes
 * (the item's photo was replaced). Read paths only emit this URL for items that
 * actually have a photo, so a 404 here just falls back to the placeholder.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.view');
    if (gate.denied) return gate.denied;

    const { id: rawId } = await params;
    const zohoItemId = String(rawId || '').trim();
    if (!zohoItemId) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // One round-trip: cached bytes (if any) + the item's current document id.
    const { rows } = await pool.query<{
      content_type: string | null;
      bytes: Buffer | null;
      cached_doc: string | null;
      cur_doc: string | null;
      item_exists: boolean;
    }>(
      `SELECT zii.content_type,
              zii.bytes,
              zii.document_id          AS cached_doc,
              i.image_document_id      AS cur_doc,
              (i.zoho_item_id IS NOT NULL) AS item_exists
         FROM items i
         LEFT JOIN zoho_item_images zii ON zii.zoho_item_id = i.zoho_item_id
        WHERE i.zoho_item_id = $1
        LIMIT 1`,
      [zohoItemId],
    );

    const row = rows[0];
    if (!row?.item_exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Serve cached bytes when they're still current (doc id unchanged, or we
    // don't yet know the current doc id).
    const cacheFresh =
      row.bytes && (!row.cur_doc || row.cached_doc === row.cur_doc);
    if (cacheFresh && row.bytes) {
      return imageResponse(row.bytes, row.content_type);
    }

    // No usable cache. If the item has no photo, there's nothing to fetch.
    if (!row.cur_doc) {
      return NextResponse.json({ error: 'No image' }, { status: 404 });
    }

    // Fetch the bytes from Zoho, cache them, and serve.
    const fetched = await fetchZohoItemImage(zohoItemId);
    if (!fetched) {
      return NextResponse.json({ error: 'Upstream image unavailable' }, { status: 404 });
    }

    await pool.query(
      `INSERT INTO zoho_item_images (zoho_item_id, document_id, content_type, bytes, fetched_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (zoho_item_id) DO UPDATE SET
         document_id  = EXCLUDED.document_id,
         content_type = EXCLUDED.content_type,
         bytes        = EXCLUDED.bytes,
         fetched_at   = now()`,
      [zohoItemId, row.cur_doc, fetched.contentType, fetched.bytes],
    );

    return imageResponse(fetched.bytes, fetched.contentType);
  } catch (error: any) {
    console.error('[zoho/items/[id]/image]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function imageResponse(bytes: Buffer, contentType: string | null) {
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType || 'image/png',
      // Product photos are not sensitive; let the browser cache aggressively.
      // A replaced photo changes image_document_id, which invalidates our cache
      // server-side, so a day of browser staleness is acceptable.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

async function fetchZohoItemImage(
  zohoItemId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const token = await getAccessToken();
  const url = `${getInventoryBaseUrl()}/items/${encodeURIComponent(zohoItemId)}/image?organization_id=${encodeURIComponent(requireOrgId())}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    // A JSON body here means Zoho returned an error envelope, not an image.
    if (contentType.includes('application/json')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { bytes: buf, contentType: contentType.split(';')[0].trim() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
