import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization, updateOrgSettings } from '@/lib/tenancy/organizations';
import type { OrgId } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org-level settings the admin UI edits. Currently scoped to the per-station
 * NAS photo-picker folder map (`stationNasPhotoFolders`) — the only key the
 * StationNasFoldersTab manages. Reads/writes go through the tenancy helpers so
 * the in-process org cache stays consistent.
 *
 * GET   → { stationNasPhotoFolders: Record<station, folderPath> }
 * PATCH → body { stationNasPhotoFolders: Record<string, string> } (merged jsonb)
 */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const org = await getOrganization(ctx.organizationId as OrgId);
  return NextResponse.json({
    stationNasPhotoFolders: org?.settings.stationNasPhotoFolders ?? {},
  });
}, { permission: 'admin.view' });

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  const raw = body?.stationNasPhotoFolders;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json(
      { error: 'stationNasPhotoFolders must be an object of { station: folderPath }' },
      { status: 400 },
    );
  }

  // Coerce to a clean Record<string,string>: trim values, drop non-string /
  // empty entries so cleared stations don't linger as "".
  const clean: Record<string, string> = {};
  for (const [station, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const folder = value.trim().replace(/^\/+|\/+$/g, '');
    if (folder) clean[station.toUpperCase()] = folder;
  }

  await updateOrgSettings(ctx.organizationId as OrgId, { stationNasPhotoFolders: clean });
  return NextResponse.json({ ok: true, stationNasPhotoFolders: clean });
}, { permission: 'admin.view' });
