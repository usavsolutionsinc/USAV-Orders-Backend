import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getProductManualById,
  updateProductManual,
} from '@/lib/neon/product-manuals-queries';
// NOTE: getProductManualById/updateProductManual accept an optional trailing
// orgId; threading it GUC-wraps the by-id read+write so RLS gates ownership
// once enforced (NEEDS-COL — product_manuals has no organization_id yet).

/**
 * POST /api/product-manuals/thumbnail
 *
 * Lazy-backfill endpoint. The browser-side viewer (`ManualLibrary`) generates
 * a thumbnail from page 1 of a manual that doesn't yet have one and POSTs
 * it here. We store the image in Vercel Blob and PATCH `thumbnail_url` onto
 * the row, so the next time anyone scans the sidebar they see the preview
 * instead of the generic file icon.
 *
 * Form fields:
 *   id         required — the manual to attach the thumbnail to
 *   thumbnail  required — the JPEG/PNG produced client-side
 *
 * Idempotent: if a manual already has a thumbnail, the caller skips the
 * generation entirely. If it sends one anyway, we overwrite (cheap; the old
 * blob is unreachable but Vercel Blob garbage-collects eventually).
 */
export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId ?? undefined;
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'multipart body required' }, { status: 400 });
    }

    const idRaw = form.get('id');
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
    }

    const thumbnail = form.get('thumbnail');
    if (!(thumbnail instanceof File) || thumbnail.size === 0) {
      return NextResponse.json({ success: false, error: 'thumbnail is required' }, { status: 400 });
    }
    // Cap at 2MB — a 320px-wide JPEG should be <100KB; anything larger is
    // a sign the client misconfigured the render (or someone's poking the
    // endpoint manually).
    if (thumbnail.size > 2 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'thumbnail exceeds 2MB' }, { status: 413 });
    }

    try {
      // Org-ownership gate: GUC-wrapped by-id read so a caller can't backfill a
      // thumbnail onto another org's manual once RLS is enforced (404 not 403).
      const existing = await getProductManualById(id, orgId);
      if (!existing) {
        return NextResponse.json({ success: false, error: 'manual not found' }, { status: 404 });
      }

      const buffer = Buffer.from(await thumbnail.arrayBuffer());
      const key = `product-manuals/thumbs/${Date.now()}_manual_${id}.jpg`;
      const uploaded = await put(key, buffer, {
        access: 'public',
        contentType: thumbnail.type || 'image/jpeg',
      });

      const row = await updateProductManual({ id, thumbnailUrl: uploaded.url }, orgId);
      return NextResponse.json({ success: true, manual: row, thumbnailUrl: uploaded.url });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'thumbnail save failed';
      console.error('[product-manuals/thumbnail] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'product_manuals.manage' },
);
