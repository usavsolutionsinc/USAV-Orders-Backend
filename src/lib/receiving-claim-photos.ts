import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, join, extname, basename } from 'node:path';
import type { NextRequest } from 'next/server';

/**
 * Server-side reader for a receiving photo's raw bytes, so the claim route can
 * upload the actual file to Zendesk (as an attachment) instead of pasting a link.
 *
 * Handles the two URL shapes the picker stores:
 *   • NAS dev route ("/api/nas-dev/<path>") → read straight off the mounted
 *     filesystem (the LAN box running the app has the share mounted). No HTTP /
 *     auth round-trip needed.
 *   • Absolute http(s) (Vercel Blob, nginx tunnel) → fetch the bytes.
 *
 * Returns null on anything unreadable so one bad photo never fails the claim.
 */

const NAS_DEV_ROOT = resolve(
  process.env.NAS_DEV_ROOT || '/Volumes/USAV Media/Puchasing photos/2026',
);
const NAS_DEV_PREFIX = '/api/nas-dev/';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface PhotoBytes {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export async function readPhotoBytes(rawUrl: string): Promise<PhotoBytes | null> {
  const url = (rawUrl || '').trim();
  if (!url) return null;
  // Drop any query (e.g. ?thumb=128) — the attachment should be the full original.
  const noQuery = url.split('?')[0];

  // NAS dev route → filesystem read.
  if (noQuery.startsWith(NAS_DEV_PREFIX)) {
    const rel = noQuery
      .slice(NAS_DEV_PREFIX.length)
      .split('/')
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
      .join('/');
    const target = resolve(NAS_DEV_ROOT, rel);
    // Path-traversal guard: stay inside the configured root.
    if (target !== NAS_DEV_ROOT && !target.startsWith(NAS_DEV_ROOT + sep)) return null;
    try {
      const buf = await readFile(target);
      const ext = extname(target).toLowerCase();
      return {
        bytes: new Uint8Array(buf),
        filename: basename(target) || 'photo.jpg',
        contentType: MIME[ext] || 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  // Absolute URL (Vercel Blob / nginx tunnel) → fetch.
  if (/^https?:\/\//i.test(noQuery)) {
    try {
      const res = await fetch(noQuery, { cache: 'no-store' });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const pathname = new URL(noQuery).pathname;
      const ext = extname(pathname).toLowerCase();
      return {
        bytes: new Uint8Array(ab),
        filename: basename(pathname) || `photo${ext || '.jpg'}`,
        contentType: res.headers.get('content-type') || MIME[ext] || 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  return null;
}

// Where per-ticket claim archives live. Defaults to the "2 Zendesk 2026" folder
// inside the photos root (a sibling of the month folders); override with env.
const CLAIM_ARCHIVE_DIR = resolve(
  process.env.ZENDESK_CLAIM_ARCHIVE_DIR || join(NAS_DEV_ROOT, '2 Zendesk 2026'),
);

/**
 * On claim creation, copy ALL of the PO's photos into a local folder named after
 * the Zendesk ticket (e.g. ".../2 Zendesk 2026/12345/") and drop a ticket-info
 * file. This is the full local record — Zendesk gets only the selected subset,
 * but the folder keeps everything in case the seller asks for more later.
 *
 * Best-effort: returns null / partial counts on failure so it never breaks an
 * already-filed claim. Reads each photo via readPhotoBytes (filesystem for NAS,
 * fetch for Blob), so it works for every photo source.
 */
export async function archiveClaimToFolder(opts: {
  ticketId: number | string;
  photos: Array<{ url: string }>;
  info: string;
}): Promise<{ folder: string; copied: number; total: number } | null> {
  const folder = join(CLAIM_ARCHIVE_DIR, String(opts.ticketId));
  try {
    await mkdir(folder, { recursive: true });
  } catch {
    return null;
  }

  let copied = 0;
  const used = new Set<string>();
  for (const p of opts.photos) {
    const pb = await readPhotoBytes(p.url);
    if (!pb) continue;
    // De-dupe filename collisions so two "IMG_001.jpg" don't clobber each other.
    let name = pb.filename;
    const key = name.toLowerCase();
    if (used.has(key)) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      name = `${base}_${copied}${ext}`;
    }
    used.add(name.toLowerCase());
    try {
      await writeFile(join(folder, name), pb.bytes);
      copied++;
    } catch {
      // skip this file; keep going
    }
  }

  try {
    await writeFile(join(folder, '_ticket-info.txt'), opts.info, 'utf8');
  } catch {
    // metadata is nice-to-have
  }

  return { folder, copied, total: opts.photos.length };
}

/**
 * Archive a claim's photos via the office "archive agent" instead of a local
 * filesystem write. This is the production path: the app runs on Vercel, which
 * can't reach the LAN NAS, so it POSTs the ticket # + photo list to the agent
 * (through the Cloudflare tunnel). The agent — running on the office machine
 * that has the share mounted — does the real mkdir + copy into
 * ".../2 Zendesk 2026/<ticket#>/".
 *
 * Returns null when the agent isn't configured (so callers can fall back to the
 * local write for dev/LAN-hosted runs). THROWS on agent/transport failure so
 * the caller can surface a warning — a filed claim whose photos didn't archive
 * must not look like a clean success.
 */
export async function archiveClaimViaAgent(opts: {
  ticketId: number | string;
  photos: Array<{ url: string }>;
  info: string;
}): Promise<{ folder: string; copied: number; total: number } | null> {
  const base = (process.env.NAS_AGENT_URL || '').replace(/\/+$/, '');
  const token = process.env.NAS_AGENT_TOKEN || '';
  if (!base || !token) return null;

  const res = await fetch(`${base}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-token': token },
    body: JSON.stringify({ ticketId: opts.ticketId, photos: opts.photos, info: opts.info }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`archive agent returned HTTP ${res.status}`);
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; folder?: string; copied?: number; total?: number; error?: string }
    | null;
  if (!data?.ok) throw new Error(data?.error || 'archive agent error');
  return {
    folder: data.folder || '',
    copied: data.copied ?? 0,
    total: data.total ?? opts.photos.length,
  };
}

/**
 * Canonical "view the PO receiving" link, built from the request origin so it
 * points at whatever host the operator is actually on (LAN URL on the LAN, the
 * public URL otherwise). Routes to the desktop receiving workspace, which
 * focuses the carton via `?recvId=` (ReceivingLinesTable deep-link) — claims
 * are worked from the desktop station, not the mobile carton page.
 */
export function poReceivingLink(req: NextRequest, receivingId: number): string {
  return `${req.nextUrl.origin}/receiving?recvId=${receivingId}`;
}
