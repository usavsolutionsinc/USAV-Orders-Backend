import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { sealManifest } from '@/lib/labels/manifest';
import { recordLabelPrintJob } from '@/lib/labels/print-jobs';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/label-manifests/[id]/seal — seal an OPEN manifest and return its
 * `manifest_uid` for the master label. Idempotent: re-sealing a SEALED manifest
 * returns it unchanged; a DISSOLVED manifest 409s. Records ONE master MANIFEST
 * row in the print ledger (idempotent per manifest). Auth: `label.manifest.manage`.
 */
export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    const id = Number(segments[segments.length - 2]); // .../[id]/seal
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid manifest id' }, { status: 400 });
    }

    try {
      const sealed = await sealManifest(id, orgId);
      if (!sealed) {
        return NextResponse.json(
          { ok: false, error: 'manifest not found or already dissolved' },
          { status: 409 },
        );
      }

      // Record the master label in the ledger. Idempotent per manifest so an
      // idempotent re-seal never double-logs.
      try {
        await recordLabelPrintJob(
          {
            jobType: 'MANIFEST',
            manifestId: sealed.id,
            unitUid: sealed.manifest_uid,
            qrPayload: sealed.manifest_uid,
            templateId: 'prebox_master',
            actorStaffId: ctx.staffId ?? null,
            clientEventId: `manifest-seal-${sealed.id}`,
          },
          orgId,
        );
      } catch (err) {
        console.warn('[POST label-manifests/seal] ledger insert failed (non-fatal)', err);
      }

      await recordAudit(pool, ctx, request, {
        source: 'label-manifests-api',
        action: AUDIT_ACTION.MANIFEST_SEAL,
        entityType: AUDIT_ENTITY.LABEL_MANIFEST,
        entityId: sealed.id,
        after: { manifest_uid: sealed.manifest_uid, sealed_at: sealed.sealed_at },
      });
      return NextResponse.json({ ok: true, manifest: sealed, manifest_uid: sealed.manifest_uid });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'seal manifest failed';
      console.error('[POST /api/label-manifests/[id]/seal] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'label.manifest.manage' },
);
