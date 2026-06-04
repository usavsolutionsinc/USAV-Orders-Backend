import { NextRequest, NextResponse } from 'next/server';
import { stat, readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Local NAS file server — the app reads the NAS folder straight off the SMB
 * mount and re-exposes it to the browser, so no separate file-server container
 * or Cloudflare tunnel is needed. This is the "just like localhost, but served
 * on the LAN" path: run the app (dev OR a production build) on any machine that
 * has the NAS share mounted, and every browser that opens that machine over http
 * gets the picker — same-origin, so no CORS and no mixed-content issues.
 *
 * It re-exposes the folder in the exact shape the browser-side client
 * (`src/lib/nas-photos.ts`) expects:
 *   • a directory  → nginx `autoindex_format json`-compatible array:
 *       [{ name, type: 'file'|'directory', size, mtime }]
 *   • a file       → the raw image bytes with an image/* content-type
 *
 * Point the app at it (relative URL → works on any host/port over http):
 *   NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=/api/nas-dev
 *   NAS_DEV_ROOT="/Volumes/USAV Media/Puchasing photos/2026"  # the mount on THIS host
 *
 * Enablement (safe by default):
 *   • dev (`next dev`)            → always on (uses NAS_DEV_ROOT or the default).
 *   • production build            → on ONLY when NAS_DEV_ROOT is set, so a LAN
 *     (`next start`/Vercel)         box opts in by setting it; Vercel (where it's
 *                                   unset and the path doesn't exist) returns 404.
 *   • always behind the app's session auth gate + a path-traversal guard, and it
 *     only ever exposes the one configured folder.
 *
 * To serve the whole office: run on a mounted LAN machine, e.g.
 *   NAS_DEV_ROOT="/Volumes/USAV Media/Puchasing photos/2026" \
 *   NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=/api/nas-dev npm run build
 *   npx next start -H 0.0.0.0 -p 3000      # staff open http://<this-ip>:3000
 * (or `npx next dev -H 0.0.0.0` for a quick, no-build LAN test).
 */

// The folder the host has mounted (SMB share "USAV Media"). Set NAS_DEV_ROOT to
// THIS machine's mount path — it differs per OS (macOS: /Volumes/...,
// Windows: a mapped drive / UNC path, Linux: the CIFS mountpoint).
const DEFAULT_ROOT = '/Volumes/USAV Media/Puchasing photos/2026';
const ROOT = resolve(process.env.NAS_DEV_ROOT || DEFAULT_ROOT);

// On in production unless explicitly opted in via NAS_DEV_ROOT (see header).
const ENABLED = Boolean(process.env.NAS_DEV_ROOT) || process.env.NODE_ENV !== 'production';

// Only web-renderable image formats are listed as files (HEIC is excluded the
// same way the client lib excludes it — browsers can't render it).
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Noise we never want to surface in the picker.
function isHidden(name: string): boolean {
  return (
    name.startsWith('.') ||
    name === '#recycle' ||
    name.toLowerCase() === 'thumbs.db'
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (!ENABLED) {
    return NextResponse.json(
      { error: 'nas-dev is disabled (set NAS_DEV_ROOT to enable in a production build)' },
      { status: 404 },
    );
  }

  const { path: segments = [] } = await params;
  // Next.js URL-decodes catch-all segments, so spaces in "JAN 2026" arrive intact.
  const target = resolve(ROOT, segments.join('/'));

  // Path-traversal guard: the resolved path must stay inside ROOT.
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // ── Directory → nginx-autoindex-compatible JSON listing ──────────────────
  if (info.isDirectory()) {
    const names = await readdir(target);
    const entries = await Promise.all(
      names.filter((n) => !isHidden(n)).map(async (name) => {
        try {
          const s = await stat(join(target, name));
          const isDir = s.isDirectory();
          if (!isDir && !IMAGE_RE.test(name)) return null; // skip non-image files
          return {
            name,
            type: isDir ? 'directory' : 'file',
            size: s.size,
            mtime: s.mtime.toISOString(),
          };
        } catch {
          return null; // unreadable entry — drop it rather than fail the listing
        }
      }),
    );
    return NextResponse.json(entries.filter(Boolean), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // ── File → stream the image bytes ────────────────────────────────────────
  const ext = extname(target).toLowerCase();
  const buf = await readFile(target);

  // Optional on-the-fly thumbnail (?thumb=<px>): a small EXIF-rotated webp so
  // the picker's row previews load in KB instead of pulling multi-MB originals.
  // sharp ships with Next 16's image optimizer; if it's unavailable or the file
  // isn't a raster image we fall through to the original bytes. Cacheable so
  // re-opening the picker doesn't regenerate.
  const thumbRaw = req.nextUrl.searchParams.get('thumb');
  if (thumbRaw && IMAGE_RE.test(target)) {
    const size = Math.min(512, Math.max(48, Number(thumbRaw) || 160));
    try {
      // Dynamic specifier ('sharp' as string) so the build does NOT statically
      // type-resolve sharp: it's a dev-only optional dep, absent from the prod
      // install under pnpm's strict node_modules (which broke `next build`).
      // Resolved from node_modules at runtime in dev; in prod this route is
      // disabled, and the catch below covers a missing module either way.
      type SharpChain = {
        rotate(): SharpChain;
        resize(w: number, h: number, o: { fit: string }): SharpChain;
        webp(o: { quality: number }): SharpChain;
        toBuffer(): Promise<Buffer>;
      };
      const sharp = (await import('sharp' as string)).default as (input: Buffer) => SharpChain;
      const out = await sharp(buf)
        .rotate()
        .resize(size, size, { fit: 'cover' })
        .webp({ quality: 70 })
        .toBuffer();
      return new NextResponse(new Uint8Array(out), {
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=600' },
      });
    } catch {
      // sharp missing / decode failure → serve the original below.
    }
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}
