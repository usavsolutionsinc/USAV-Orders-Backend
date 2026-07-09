import { NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { createManifest } from '@/lib/labels/manifest';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/label-manifests — create an OPEN label manifest (the "one label,
 * many serials" preboxed kit), optionally seeded with units. Returns the new
 * manifest detail plus any units skipped because they're already in another live
 * manifest (`conflicts`). Auth: `label.manifest.manage`.
 */
const Body = z.object({
  manifestType: z.enum(['PREBOX', 'KIT', 'MASTER_CARTON']).optional(),
  sku: z.string().trim().min(1).nullable().optional(),
  skuCatalogId: z.number().int().positive().nullable().optional(),
  conditionGrade: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  serialUnitIds: z.array(z.number().int().positive()).max(500).optional(),
});

export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const { manifest, conflicts } = await createManifest(
        { ...parsed.data, createdBy: ctx.staffId ?? null },
        orgId,
      );
      await recordAudit(pool, ctx, request, {
        source: 'label-manifests-api',
        action: AUDIT_ACTION.MANIFEST_CREATE,
        entityType: AUDIT_ENTITY.LABEL_MANIFEST,
        entityId: manifest.id,
        after: {
          manifest_uid: manifest.manifest_uid,
          type: manifest.manifest_type,
          items: manifest.items.length,
          conflicts,
        },
      });
      return NextResponse.json({ ok: true, manifest, conflicts }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create manifest failed';
      console.error('[POST /api/label-manifests] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'label.manifest.manage' },
);
