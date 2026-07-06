import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { removeManifestItem } from '@/lib/labels/manifest';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/label-manifests/[id]/items/[serialUnitId] — remove one unit from a
 * manifest (split one out). Frees the unit for another manifest. Auth:
 * `label.manifest.manage`.
 */
export const DELETE = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    // .../label-manifests/[id]/items/[serialUnitId]
    const serialUnitId = Number(segments[segments.length - 1]);
    const id = Number(segments[segments.length - 3]);
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(serialUnitId) || serialUnitId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid id(s)' }, { status: 400 });
    }

    try {
      const { manifest, removed } = await removeManifestItem(id, serialUnitId, orgId);
      if (!manifest) {
        return NextResponse.json({ ok: false, error: 'manifest not found' }, { status: 404 });
      }
      await recordAudit(pool, ctx, request, {
        source: 'label-manifests-api',
        action: AUDIT_ACTION.MANIFEST_REMOVE_ITEM,
        entityType: AUDIT_ENTITY.LABEL_MANIFEST,
        entityId: id,
        after: { serial_unit_id: serialUnitId, removed },
      });
      return NextResponse.json({ ok: true, manifest, removed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'remove manifest item failed';
      console.error('[DELETE /api/label-manifests/[id]/items/[serialUnitId]] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'label.manifest.manage' },
);
