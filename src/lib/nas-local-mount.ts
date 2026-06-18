import 'server-only';

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';

const DEFAULT_ROOT = '/Volumes/USAV Media/Puchasing photos/2026';

export const NAS_LOCAL_IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function nasLocalMountRoot(): string {
  return resolve(process.env.NAS_DEV_ROOT || DEFAULT_ROOT);
}

/** True when `next dev` (or NAS_DEV_ROOT in prod) may read/write the SMB mount. */
export function isNasLocalMountEnabled(): boolean {
  return Boolean(process.env.NAS_DEV_ROOT) || process.env.NODE_ENV !== 'production';
}

/** Dev default: write through the mount unless NAS_RW_URL overrides remote upstream. */
export function shouldNasProxyUseLocalMount(): boolean {
  if ((process.env.NAS_RW_URL || '').trim()) return false;
  return isNasLocalMountEnabled() && process.env.NODE_ENV !== 'production';
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || name === '#recycle' || name.toLowerCase() === 'thumbs.db';
}

export function resolveNasLocalTarget(segments: string[]): string | null {
  const decoded = segments.map((s) => decodeURIComponent(s));
  if (decoded.some((seg) => seg === '..' || /^([a-z]+:)?\/\//i.test(seg))) return null;
  const target = resolve(nasLocalMountRoot(), decoded.join('/'));
  const root = nasLocalMountRoot();
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export async function listNasLocalDir(segments: string[]) {
  const target = resolveNasLocalTarget(segments);
  if (!target) return { ok: false as const, status: 403, error: 'forbidden' };
  let info;
  try {
    info = await stat(target);
  } catch {
    return { ok: false as const, status: 404, error: 'not found' };
  }
  if (!info.isDirectory()) {
    return { ok: false as const, status: 404, error: 'not found' };
  }
  const names = await readdir(target);
  const entries = (
    await Promise.all(
      names.filter((n) => !isHidden(n)).map(async (name) => {
        try {
          const s = await stat(join(target, name));
          const isDir = s.isDirectory();
          if (!isDir && !NAS_LOCAL_IMAGE_RE.test(name)) return null;
          return {
            name,
            type: isDir ? 'directory' : 'file',
            size: s.size,
            mtime: s.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);
  return { ok: true as const, entries };
}

export async function readNasLocalFile(segments: string[]) {
  const target = resolveNasLocalTarget(segments);
  if (!target) return { ok: false as const, status: 403, error: 'forbidden' };
  try {
    const info = await stat(target);
    if (!info.isFile()) return { ok: false as const, status: 404, error: 'not found' };
    const buf = await readFile(target);
    const ext = extname(target).toLowerCase();
    return {
      ok: true as const,
      body: buf,
      contentType: MIME[ext] || 'application/octet-stream',
    };
  } catch {
    return { ok: false as const, status: 404, error: 'not found' };
  }
}

export async function writeNasLocalFile(segments: string[], body: ArrayBuffer) {
  const target = resolveNasLocalTarget(segments);
  if (!target) return { ok: false as const, status: 403, error: 'forbidden' };
  if (!NAS_LOCAL_IMAGE_RE.test(target)) {
    return { ok: false as const, status: 400, error: 'only image files are allowed' };
  }
  if (body.byteLength === 0) {
    return { ok: false as const, status: 400, error: 'empty body' };
  }
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(body));
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 500, error: 'write failed' };
  }
}

export async function deleteNasLocalFile(segments: string[]) {
  const target = resolveNasLocalTarget(segments);
  if (!target) return { ok: false as const, status: 403, error: 'forbidden' };
  try {
    await unlink(target);
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 404, error: 'not found' };
  }
}

export function nasPathSegmentsFromProxyPath(pathname: string): string[] {
  const sub = pathname.replace(/^\/api\/nas\/?/, '');
  if (!sub) return [];
  return sub.split('/').map((s) => decodeURIComponent(s)).filter(Boolean);
}
