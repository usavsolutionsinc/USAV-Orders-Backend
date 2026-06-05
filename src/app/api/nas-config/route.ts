import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getNasConfigForOperator } from '@/lib/nas-photos-server';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * Runtime NAS config for the browser.
 *
 * Receiving photos are written straight to the office NAS over WebDAV, so the
 * client needs to know (a) the active NAS base URL (admin picks test vs prod via
 * `nasPhotoServers`) and (b) the folder this operator's station opens/writes
 * into. Both are org-scoped runtime settings, so they can't be baked into the
 * build the way the old NEXT_PUBLIC_NAS_PHOTOS_BASE_URL env var was.
 *
 * GET → { baseUrl, folder }   ('' baseUrl = NAS not configured for this org)
 */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const config = await getNasConfigForOperator(ctx.organizationId as OrgId, ctx.staffId);
  return NextResponse.json(config);
}, { permission: 'receiving.view' });
