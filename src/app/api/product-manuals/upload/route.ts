import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { withAuth } from '@/lib/auth/withAuth';
import {
  upsertProductManual,
  updateProductManual,
  getProductManualById,
} from '@/lib/neon/product-manuals-queries';

/**
 * POST /api/product-manuals/upload
 *
 * Multipart upload for PDFs (and other previewable formats). Two modes:
 *   - create   — no `id` in the form → new row, blob saved at
 *                `product-manuals/<timestamp>_<slug>.pdf`, row goes in as
 *                `status='unassigned'` unless caller passes one.
 *   - replace  — `id` present → swaps the blob on the existing row and
 *                `del()`s the previous source_url (best-effort; non-fatal
 *                if the old blob is already gone).
 *
 * Why a dedicated multipart route instead of reusing the CRUD POST: that
 * endpoint takes JSON and assumes the file already lives somewhere with a
 * public URL. This route owns the Blob lifecycle so the UI can hand a File
 * straight from `<input type="file">`.
 *
 * Form fields:
 *   file          required — the PDF/binary
 *   id            optional — when present, replaces the existing manual's blob
 *   displayName   optional — defaults to the file's name (stripped of .pdf)
 *   folderPath    optional — '/'-separated; pre-filled to current breadcrumb
 *   type          optional — manual | troubleshooting | installation | …
 *   sku           optional
 *   itemNumber    optional
 *   status        optional — defaults to 'unassigned'
 */
export const POST = withAuth(
  async (request) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'multipart body required' }, { status: 400 });
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'file is empty' }, { status: 400 });
    }
    // 50MB ceiling — Vercel Blob can take more, but operators dropping huge
    // scans into the library is almost always a mistake. Bump if a real case
    // shows up.
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'file exceeds 50MB' }, { status: 413 });
    }

    const idRaw = form.get('id');
    const id = idRaw != null && idRaw !== '' ? Number(idRaw) : null;
    if (idRaw != null && idRaw !== '' && (!Number.isFinite(id) || id! <= 0)) {
      return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
    }

    const folderPath = String(form.get('folderPath') || '').trim() || null;
    const displayName =
      String(form.get('displayName') || '').trim()
      || file.name.replace(/\.[a-z0-9]+$/i, '');
    const type = String(form.get('type') || '').trim() || null;
    const sku = String(form.get('sku') || '').trim() || null;
    const itemNumber = String(form.get('itemNumber') || '').trim() || null;
    const statusRaw = String(form.get('status') || '').trim();
    const status =
      statusRaw === 'assigned' || statusRaw === 'archived' ? statusRaw : 'unassigned';

    // Sanitize the filename slug — strip path traversal, collapse spaces.
    const safeName = file.name
      .replace(/[/\\]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    const blobKey = `product-manuals/${Date.now()}_${safeName || 'manual.pdf'}`;
    const contentType = file.type || 'application/pdf';

    try {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Replace flow: load the existing row first so we can clean up its blob.
      let previousSourceUrl: string | null = null;
      if (id) {
        const existing = await getProductManualById(id);
        if (!existing) {
          return NextResponse.json({ success: false, error: 'manual not found' }, { status: 404 });
        }
        previousSourceUrl = existing.source_url || null;
      }

      const uploaded = await put(blobKey, buffer, { access: 'public', contentType });

      // upsertProductManual hardcodes sku = NULL on insert (the column is
      // populated separately via updateProductManual). For the create flow,
      // if the operator supplied a SKU we PATCH it in after the row exists.
      let row = id
        ? await updateProductManual({
            id,
            sourceUrl: uploaded.url,
            displayName,
            ...(folderPath != null ? { folderPath } : {}),
            ...(type ? { type } : {}),
            ...(sku ? { sku } : {}),
            ...(itemNumber ? { itemNumber } : {}),
          })
        : await upsertProductManual({
            sourceUrl: uploaded.url,
            displayName,
            folderPath,
            type,
            itemNumber,
            status,
            // Use the uploaded blob's basename as the file_name so the search
            // matcher can match against it.
            fileName: file.name,
          });

      if (!id && sku) {
        row = await updateProductManual({ id: row.id, sku });
      }

      // Best-effort delete of the old blob — never throw, since the DB row
      // already points at the new URL and a stale blob is harmless.
      if (previousSourceUrl && previousSourceUrl !== uploaded.url) {
        try { await del(previousSourceUrl); } catch { /* ignore */ }
      }

      return NextResponse.json({ success: true, manual: row, blobUrl: uploaded.url });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'upload failed';
      console.error('[product-manuals/upload] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'product_manuals.manage' },
);
