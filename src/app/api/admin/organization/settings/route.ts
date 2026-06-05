import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization, updateOrgSettings } from '@/lib/tenancy/organizations';
import type { OrgSettings } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org-level settings the admin UI edits, managed by StationNasFoldersTab:
 *   • stationNasPhotoFolders — per-station default folder for the photo picker.
 *   • nasPhotoServers        — the test/prod NAS base URLs + which is active.
 * Reads/writes go through the tenancy helpers so the in-process org cache stays
 * consistent. PATCH merges only the keys present in the body.
 *
 * GET   → { stationNasPhotoFolders, nasPhotoServers }
 * PATCH → body may contain either/both key; merged into jsonb settings.
 */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const org = await getOrganization(ctx.organizationId as OrgId);
  return NextResponse.json({
    stationNasPhotoFolders: org?.settings.stationNasPhotoFolders ?? {},
    nasPhotoServers: org?.settings.nasPhotoServers ?? { test: '', prod: '', active: 'prod' },
  });
}, { permission: 'admin.view' });

// A NAS base URL must be http(s) (the browser PUTs to it cross-origin) or the
// same-origin dev proxy path "/api/nas-dev". Empty is allowed (slot not set).
function cleanNasUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const v = value.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (v.startsWith('/')) return v; // dev proxy, e.g. /api/nas-dev
  return /^https?:\/\//i.test(v) ? v : '';
}

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  // ── stationNasPhotoFolders ──────────────────────────────────────────────
  if ('stationNasPhotoFolders' in body) {
    const raw = (body as Record<string, unknown>).stationNasPhotoFolders;
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
    patch.stationNasPhotoFolders = clean;
  }

  // ── nasPhotoServers (test/prod URLs + active slot) ──────────────────────
  if ('nasPhotoServers' in body) {
    const raw = (body as Record<string, unknown>).nasPhotoServers;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json(
        { error: 'nasPhotoServers must be an object of { test, prod, active }' },
        { status: 400 },
      );
    }
    const r = raw as Record<string, unknown>;
    const active = r.active === 'test' ? 'test' : 'prod';
    patch.nasPhotoServers = {
      test: cleanNasUrl(r.test),
      prod: cleanNasUrl(r.prod),
      active,
    };
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Provide stationNasPhotoFolders and/or nasPhotoServers' },
      { status: 400 },
    );
  }

  await updateOrgSettings(ctx.organizationId as OrgId, patch as Partial<OrgSettings>);
  return NextResponse.json({ ok: true, ...patch });
}, { permission: 'admin.view' });
