import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getManifestDetailByRef } from '@/lib/labels/manifest';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/label-manifests/[id] — manifest detail + its member units with line
 * attribution (origin_receiving_line_id per unit). Accepts a numeric id OR a
 * `KIT-…` manifest_uid (a scanned master label), so the same endpoint serves the
 * app's links and a raw scan. Read side for the manifest panel + prebox wizard.
 * Auth: `print.label`.
 */
export const GET = withAuth(
  async (request, ctx) => {
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    const ref = decodeURIComponent(segments[segments.length - 1] ?? ''); // .../label-manifests/[id|uid]
    if (!ref) {
      return NextResponse.json({ ok: false, error: 'invalid manifest ref' }, { status: 400 });
    }
    try {
      const manifest = await getManifestDetailByRef(ref, ctx.organizationId as OrgId);
      if (!manifest) {
        return NextResponse.json({ ok: false, error: 'manifest not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, manifest });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'manifest detail failed';
      console.error('[GET /api/label-manifests/[id]] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'print.label' },
);
