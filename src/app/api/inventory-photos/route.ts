import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { attachPhotoWithLegacyUrl } from '@/lib/photos/service';
import { photoContentUrl } from '@/lib/photos/display-url';

/**
 * POST /api/inventory-photos
 *
 * Generic photo attachment for inventory events — used by the Numpad sheet
 * when a reason code requires photographic evidence (DAMAGED, SCRAP, …)
 * or when a large variance fires a manual-photo prompt.
 *
 * Body: { photoBase64, ledgerId?, alertId?, sku?, binId?, staffId, photoType? }
 *
 * The photo lands in Vercel Blob at:
 *   bin_adjustments/{ledgerId or 'orphan'}/{ts}.jpg
 *
 * One row inserted into the unified `photos` table with
 * entity_type='BIN_ADJUSTMENT' and entity_id = ledgerId (when supplied).
 */

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const photoBase64: string | undefined = body?.photoBase64;
    const ledgerId =
      Number.isFinite(Number(body?.ledgerId)) && Number(body?.ledgerId) > 0
        ? Math.floor(Number(body?.ledgerId))
        : null;
    const alertId =
      Number.isFinite(Number(body?.alertId)) && Number(body?.alertId) > 0
        ? Math.floor(Number(body?.alertId))
        : null;
    const sku = String(body?.sku || '').trim() || null;
    const binId =
      Number.isFinite(Number(body?.binId)) && Number(body?.binId) > 0
        ? Math.floor(Number(body?.binId))
        : null;
    // Server-trusted actor — body.staffId is ignored.
    const staffId = ctx.staffId;
    const photoType = String(body?.photoType || 'bin_adjustment').trim() || 'bin_adjustment';

    if (!photoBase64) {
      return NextResponse.json({ error: 'photoBase64 is required' }, { status: 400 });
    }

    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const slot = ledgerId ?? 'orphan';
    const filename = `bin_adjustments/${slot}/${Date.now()}.jpg`;
    const blob = await put(filename, buffer, { access: 'public', contentType: 'image/jpeg' });

    // photos.entity_id is NOT NULL — only insert when we have a ledgerId to
    // hang the photo on. Orphan uploads (no ledger row) still land in Blob
    // storage so they aren't lost; the audit linkage is just missing.
    let inserted: { id: number } | null = null;
    if (ledgerId != null) {
      const attached = await attachPhotoWithLegacyUrl({
        organizationId: ctx.organizationId,
        staffId,
        entityType: 'BIN_ADJUSTMENT',
        entityId: ledgerId,
        legacyUrl: blob.url,
        photoType,
      });
      inserted = { id: attached.id };

      inserted = await withTenantTransaction(ctx.organizationId, async (client) => {
        // Best-effort: stamp the photo url into an adjacent inventory_events
        // payload so the audit timeline shows the link without an extra join.
        try {
          const displayUrl = photoContentUrl(attached.id);
          await client.query(
            `UPDATE inventory_events
             SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('photo_url', $1::text, 'photo_id', $2::int)
             WHERE stock_ledger_id = $3
               AND organization_id = $4`,
            [displayUrl, attached.id, ledgerId, ctx.organizationId],
          );
        } catch {
          /* non-fatal */
        }

        return { id: attached.id };
      });
    }

    return NextResponse.json({
      success: true,
      photo: {
        id: inserted?.id ?? null,
        url: blob.url,
        ledgerId,
        alertId,
        sku,
        binId,
      },
    });
  } catch (err: any) {
    console.error('[POST /api/inventory-photos] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to save photo' },
      { status: 500 },
    );
  }
}, { permission: 'bin.adjust' });
