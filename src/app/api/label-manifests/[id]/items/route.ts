import { NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { addManifestItems } from '@/lib/labels/manifest';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/label-manifests/[id]/items — add units to an OPEN manifest (combine).
 * Units already in another live manifest are skipped and returned in `conflicts`
 * (one live manifest per unit). Auth: `label.manifest.manage`.
 */
const Body = z.object({
  serialUnitIds: z.array(z.number().int().positive()).min(1).max(500),
});

export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    const id = Number(segments[segments.length - 2]); // .../[id]/items
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid manifest id' }, { status: 400 });
    }
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const { manifest, added, conflicts } = await addManifestItems(
        id,
        parsed.data.serialUnitIds,
        orgId,
      );
      if (!manifest) {
        return NextResponse.json({ ok: false, error: 'manifest not found' }, { status: 404 });
      }
      await recordAudit(pool, ctx, request, {
        source: 'label-manifests-api',
        action: AUDIT_ACTION.MANIFEST_ADD_ITEM,
        entityType: AUDIT_ENTITY.LABEL_MANIFEST,
        entityId: id,
        after: { added, conflicts },
      });
      return NextResponse.json({ ok: true, manifest, added, conflicts });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'add manifest items failed';
      console.error('[POST /api/label-manifests/[id]/items] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'label.manifest.manage' },
);
