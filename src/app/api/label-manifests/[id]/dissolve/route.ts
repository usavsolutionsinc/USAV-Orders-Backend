import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { dissolveManifest } from '@/lib/labels/manifest';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/label-manifests/[id]/dissolve — split the kit back to singles: mark
 * the manifest DISSOLVED and remove its items so the units are free to
 * re-manifest. Idempotent under retry. Auth: `label.manifest.manage`.
 */
export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    const id = Number(segments[segments.length - 2]); // .../[id]/dissolve
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid manifest id' }, { status: 400 });
    }

    try {
      const dissolved = await dissolveManifest(id, orgId);
      if (!dissolved) {
        return NextResponse.json({ ok: false, error: 'manifest not found' }, { status: 404 });
      }
      await recordAudit(pool, ctx, request, {
        source: 'label-manifests-api',
        action: AUDIT_ACTION.MANIFEST_DISSOLVE,
        entityType: AUDIT_ENTITY.LABEL_MANIFEST,
        entityId: dissolved.id,
        after: { manifest_uid: dissolved.manifest_uid, status: dissolved.status },
      });
      return NextResponse.json({ ok: true, manifest: dissolved });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'dissolve manifest failed';
      console.error('[POST /api/label-manifests/[id]/dissolve] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'label.manifest.manage' },
);
