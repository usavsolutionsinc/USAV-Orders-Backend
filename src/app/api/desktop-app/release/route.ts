import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

/**
 * GET /api/desktop-app/release
 *
 * Returns installer URLs for the latest Cycle Forge desktop app build.
 *
 * Source of truth is Vercel Blob: installers uploaded via
 *   `npm run desktop:upload`  →  scripts/upload-desktop-installers.mjs
 * land under the `desktop-installers/` prefix. We list that prefix and pick
 * the right asset by filename (matching the electron-builder naming scheme).
 *
 * If Blob is empty or fails, we fall back to the GitHub Releases for the repo
 * (the electron-builder auto-updater target). That keeps the install button
 * functional even if uploads haven't run yet.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     version: "1.2.3",                  // parsed from filename
 *     source: "blob" | "github",
 *     releaseUrl?: string,               // only set for github source
 *     publishedAt?: string,
 *     installers: { macArm64?, macX64?, win? }
 *   }
 *
 * Failure shape (200 OK so the client renders the fallback UI cleanly):
 *   { ok: false, reason: string, releaseUrl: string }
 */
export const dynamic = 'force-dynamic';

const GH_OWNER = 'usavsolutionsinc';
const GH_REPO = 'USAV-Orders-Backend';
const RELEASE_PAGE = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`;
const BLOB_PREFIX = 'desktop-installers/';

type Installers = {
  macArm64?: string;
  macX64?: string;
  win?: string;
};

function classifyFilename(name: string): keyof Installers | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dmg')) {
    return lower.includes('arm64') || lower.includes('aarch64') ? 'macArm64' : 'macX64';
  }
  if (lower.endsWith('.exe')) return 'win';
  return null;
}

// Best-effort version parse from the electron-builder filename pattern, e.g.
// "USAV Orders-0.1.0-arm64.dmg" → "0.1.0", "USAV Orders Setup 0.1.0.exe" → "0.1.0".
function parseVersion(name: string): string | undefined {
  const match = name.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
  return match?.[1];
}

async function fromBlob(): Promise<
  | {
      ok: true;
      source: 'blob';
      version: string;
      publishedAt?: string;
      installers: Installers;
    }
  | { ok: false; reason: string }
> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, reason: 'blob_not_configured' };
  }

  const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 100 });
  if (!blobs.length) return { ok: false, reason: 'blob_empty' };

  // Pick the newest object per platform, in case multiple versions coexist.
  type Candidate = { url: string; uploadedAt: Date; version?: string; filename: string };
  const buckets: Record<keyof Installers, Candidate | undefined> = {
    macArm64: undefined,
    macX64: undefined,
    win: undefined,
  };

  for (const b of blobs) {
    const filename = b.pathname.slice(BLOB_PREFIX.length);
    if (!filename) continue;
    const key = classifyFilename(filename);
    if (!key) continue;
    const uploadedAt = new Date(b.uploadedAt);
    const existing = buckets[key];
    if (!existing || uploadedAt > existing.uploadedAt) {
      buckets[key] = { url: b.url, uploadedAt, version: parseVersion(filename), filename };
    }
  }

  const installers: Installers = {
    macArm64: buckets.macArm64?.url,
    macX64: buckets.macX64?.url,
    win: buckets.win?.url,
  };
  const hasAny = installers.macArm64 || installers.macX64 || installers.win;
  if (!hasAny) return { ok: false, reason: 'blob_no_installers' };

  const newest = [buckets.macArm64, buckets.macX64, buckets.win]
    .filter(Boolean)
    .sort((a, b) => b!.uploadedAt.getTime() - a!.uploadedAt.getTime())[0]!;

  return {
    ok: true,
    source: 'blob',
    version: newest.version ?? '',
    publishedAt: newest.uploadedAt.toISOString(),
    installers,
  };
}

type GhAsset = {
  name: string;
  browser_download_url: string;
};
type GhRelease = {
  tag_name: string;
  html_url: string;
  published_at: string;
  draft: boolean;
  assets: GhAsset[];
};

async function fromGithub(): Promise<
  | {
      ok: true;
      source: 'github';
      version: string;
      releaseUrl: string;
      publishedAt: string;
      installers: Installers;
    }
  | { ok: false; reason: string; releaseUrl: string }
> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'usav-orders-desktop-app-page',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`,
    { headers, next: { revalidate: 300 } },
  );
  if (!res.ok) {
    return { ok: false, reason: `github_${res.status}`, releaseUrl: RELEASE_PAGE };
  }
  const release = (await res.json()) as GhRelease;
  if (release.draft) {
    return { ok: false, reason: 'no_published_release', releaseUrl: RELEASE_PAGE };
  }

  const installers: Installers = {};
  for (const asset of release.assets ?? []) {
    const key = classifyFilename(asset.name);
    if (key && !installers[key]) installers[key] = asset.browser_download_url;
  }
  const hasAny = installers.macArm64 || installers.macX64 || installers.win;
  if (!hasAny) {
    return {
      ok: false,
      reason: 'no_installer_assets',
      releaseUrl: release.html_url || RELEASE_PAGE,
    };
  }

  return {
    ok: true,
    source: 'github',
    version: release.tag_name?.replace(/^v/, '') ?? '',
    releaseUrl: release.html_url || RELEASE_PAGE,
    publishedAt: release.published_at,
    installers,
  };
}

export async function GET() {
  // Prefer Blob (the website install button source of truth). Fall back to
  // GitHub so the page still works if Blob isn't populated yet.
  try {
    const blob = await fromBlob();
    if (blob.ok) return NextResponse.json(blob);
  } catch (err) {
    console.error('[desktop-app/release] Blob lookup failed:', err);
  }

  try {
    const gh = await fromGithub();
    return NextResponse.json(gh);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: 'fetch_failed',
      message: err instanceof Error ? err.message : String(err),
      releaseUrl: RELEASE_PAGE,
    });
  }
}
