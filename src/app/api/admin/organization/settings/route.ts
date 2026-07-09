import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization, updateOrgSettings } from '@/lib/tenancy/organizations';
import {
  DEFAULT_NAS_STORAGE_TARGETS,
  getPhotoAnalysisSettings,
  type OrgSettings,
} from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';
import { syncAgentRootsFromSettings } from '@/lib/nas-agent-client';
import { normalizeProvider } from '@/lib/photos/analyze-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org-level settings the admin UI edits, managed by StationNasFoldersTab:
 *   • stationNasPhotoFolders — per-station default folder for the photo picker.
 *   • nasPhotoServers        — the test/prod NAS base URLs + which is active.
 *   • nasStorageTargets      — workflow roots/folders for receiving, labels,
 *                              and claim archives.
 * Reads/writes go through the tenancy helpers so the in-process org cache stays
 * consistent. PATCH merges only the keys present in the body.
 *
 * GET   → { stationNasPhotoFolders, nasPhotoServers, nasStorageTargets }
 * PATCH → body may contain either/both key; merged into jsonb settings.
 */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const org = await getOrganization(ctx.organizationId as OrgId);
  const photoAnalysis = org
    ? getPhotoAnalysisSettings(org.settings)
    : { localVisionBaseUrl: '' };
  return NextResponse.json({
    stationNasPhotoFolders: org?.settings.stationNasPhotoFolders ?? {},
    nasPhotoServers: org?.settings.nasPhotoServers ?? { test: '', prod: '', active: 'prod' },
    nasStorageTargets: org?.settings.nasStorageTargets ?? DEFAULT_NAS_STORAGE_TARGETS,
    photoAnalysis: {
      // null provider/enabled means "inherit the deployment default" — the UI shows
      // that as the local-first default until the org explicitly picks.
      provider: photoAnalysis.provider ?? null,
      enabled: photoAnalysis.enabled ?? null,
      localVisionBaseUrl: photoAnalysis.localVisionBaseUrl ?? '',
    },
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

function cleanRootPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

function cleanRelativeFolder(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\/+|\/+$/g, '');
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

  // ── nasStorageTargets (workflow roots + active folders) ─────────────────
  if ('nasStorageTargets' in body) {
    const raw = (body as Record<string, unknown>).nasStorageTargets;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json(
        { error: 'nasStorageTargets must be an object of { receiving, shipping, claims }' },
        { status: 400 },
      );
    }
    const r = raw as Record<string, unknown>;
    const cleanTarget = (key: 'receiving' | 'shipping' | 'claims') => {
      const current = r[key];
      const obj = current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
      return {
        root: cleanRootPath(obj.root),
        folder: cleanRelativeFolder(obj.folder),
      };
    };
    patch.nasStorageTargets = {
      receiving: cleanTarget('receiving'),
      shipping: cleanTarget('shipping'),
      claims: cleanTarget('claims'),
    };
  }

  // ── photoAnalysis (per-org AI-analysis engine choice) ───────────────────
  if ('photoAnalysis' in body) {
    const raw = (body as Record<string, unknown>).photoAnalysis;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json(
        { error: 'photoAnalysis must be an object of { provider, enabled, localVisionBaseUrl }' },
        { status: 400 },
      );
    }
    const r = raw as Record<string, unknown>;
    // jsonb `||` replaces the whole photoAnalysis key, so merge over the CURRENT
    // value — a partial patch (e.g. just the URL) must not clobber provider/enabled.
    const currentOrg = await getOrganization(ctx.organizationId as OrgId);
    const current = currentOrg ? getPhotoAnalysisSettings(currentOrg.settings) : { localVisionBaseUrl: '' };
    const next: Record<string, unknown> = {
      ...(current.provider ? { provider: current.provider } : {}),
      ...(typeof current.enabled === 'boolean' ? { enabled: current.enabled } : {}),
      localVisionBaseUrl: current.localVisionBaseUrl ?? '',
    };

    if ('provider' in r) {
      if (r.provider === null) {
        delete next.provider; // clear → inherit deployment default
      } else {
        const provider = normalizeProvider(typeof r.provider === 'string' ? r.provider : null);
        if (!provider) {
          return NextResponse.json(
            { error: 'provider must be one of local-vision | hermes | gcp-vision | catalog' },
            { status: 400 },
          );
        }
        next.provider = provider;
      }
    }

    if ('enabled' in r) {
      if (r.enabled !== null && typeof r.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be a boolean or null' }, { status: 400 });
      }
      if (r.enabled === null) delete next.enabled;
      else next.enabled = r.enabled;
    }

    if ('localVisionBaseUrl' in r) {
      // Server-reachable tunnel URL the cron uses; must be http(s) or empty.
      next.localVisionBaseUrl = cleanNasUrl(r.localVisionBaseUrl);
    }

    patch.photoAnalysis = next;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        error:
          'Provide stationNasPhotoFolders, nasPhotoServers, nasStorageTargets, and/or photoAnalysis',
      },
      { status: 400 },
    );
  }

  await updateOrgSettings(ctx.organizationId as OrgId, patch as Partial<OrgSettings>);

  let agentSync: { ok: boolean; error?: string } | undefined;
  if ('nasStorageTargets' in patch) {
    const org = await getOrganization(ctx.organizationId as OrgId);
    if (org) {
      agentSync = await syncAgentRootsFromSettings(org.settings, ctx.organizationId as OrgId);
    }
  }

  return NextResponse.json({ ok: true, ...patch, ...(agentSync ? { agentSync } : {}) });
}, { permission: 'admin.view' });
