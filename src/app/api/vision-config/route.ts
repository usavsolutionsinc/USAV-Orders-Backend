import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vision-config → { baseUrl }
 *
 * Runtime base URL of the active visual-identify service (the RTX 5070 Ti box on
 * the LAN). Mirrors /api/nas-config: the app is Vercel-hosted and can't reach the
 * LAN, so the BROWSER posts the captured frame straight to the vision box and we
 * only hand it the URL here. Kept a runtime value (not a build-time constant) so an
 * admin can flip a test vs prod box without a rebuild — for now sourced from
 * NEXT_PUBLIC_VISION_BASE_URL; move to org settings (like nasPhotoServers) when a
 * second box exists.
 *
 * '' baseUrl = visual identify not configured for this org → the UI hides the
 * "Identify with camera" affordance.
 */
export const GET = withAuth(
  async (_req: NextRequest) => {
    const baseUrl = (process.env.NEXT_PUBLIC_VISION_BASE_URL || '').replace(/\/+$/, '');
    return NextResponse.json({ baseUrl });
  },
  { permission: 'receiving.view' },
);
