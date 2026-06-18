#!/usr/bin/env node
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || process.env.NAS_AGENT_PORT || 8787);
const TOKEN = process.env.NAS_AGENT_TOKEN || '';
const ALLOW_UNAUTH = process.env.NAS_AGENT_ALLOW_UNAUTH === 'true';
const MAX_UPLOAD_BYTES = Number(process.env.NAS_AGENT_MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const ALLOWED_REQUEST_ROOT_PREFIXES = (process.env.NAS_AGENT_ALLOWED_ROOT_PREFIXES || '/Volumes,/volume1')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const ROOTS = {
  receiving: cleanRoot(process.env.NAS_ROOT_RECEIVING || '/Volumes/USAV Media/Puchasing photos/2026'),
  shipping: cleanRoot(process.env.NAS_ROOT_SHIPPING || '/Volumes/Shipping/2026'),
  claims: cleanRoot(process.env.NAS_ROOT_CLAIMS || '/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026'),
};

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const WRITE_RE = /\.(jpe?g|png|webp|gif|pdf|txt)$/i;
const MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function cleanRoot(value) {
  return resolve(String(value || '').trim()).replace(/\/+$/, '');
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function authenticate(req, res) {
  if (ALLOW_UNAUTH && !TOKEN) return true;
  if (!TOKEN) {
    json(res, 503, { ok: false, error: 'NAS_AGENT_TOKEN is required unless NAS_AGENT_ALLOW_UNAUTH=true' });
    return false;
  }
  if (req.headers['x-agent-token'] === TOKEN) return true;
  json(res, 401, { ok: false, error: 'unauthorized' });
  return false;
}

function splitApiPath(pathname, prefix) {
  const rest = pathname.slice(prefix.length).replace(/^\/+/, '');
  const [rootKey = '', ...parts] = rest.split('/');
  return {
    rootKey,
    relPath: parts.map(decodeSegment).join('/').replace(/^\/+|\/+$/g, ''),
  };
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function rootPath(rootKey) {
  if (!Object.hasOwn(ROOTS, rootKey)) return null;
  return ROOTS[rootKey];
}

/** Per-request root override from Vercel (Admin → NAS Photos workflow roots). */
function effectiveRoot(req, rootKey) {
  const fallback = rootPath(rootKey);
  if (!fallback) return null;
  const headerRoot = String(req.headers['x-nas-root'] || '').trim();
  return requestRootPath(headerRoot, fallback);
}

function resolveInside(root, relPath = '') {
  const normalizedRel = String(relPath || '').replace(/^\/+|\/+$/g, '');
  const target = resolve(root, normalizedRel);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function requestRootPath(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const target = cleanRoot(raw);
  if (ALLOWED_REQUEST_ROOT_PREFIXES.some((prefix) => target === prefix || target.startsWith(prefix + sep))) {
    return target;
  }
  return fallback;
}

function contentTypeFor(path) {
  return MIME.get(extname(path).toLowerCase()) || 'application/octet-stream';
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error('JSON body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleList(req, res, url) {
  const rootKey = url.searchParams.get('root') || splitApiPath(url.pathname, '/list').rootKey;
  const relPath = url.searchParams.get('path') || splitApiPath(url.pathname, '/list').relPath;
  const root = effectiveRoot(req, rootKey);
  if (!root) return json(res, 404, { ok: false, error: 'unknown root' });
  const dir = resolveInside(root, relPath);
  if (!dir) return json(res, 403, { ok: false, error: 'forbidden path' });

  return listDirectory(res, dir);
}

async function listDirectory(res, dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return json(res, 404, { ok: false, error: 'folder not found' });
  }

  const rows = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    const s = await stat(path).catch(() => null);
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      is_dir: entry.isDirectory(),
      size: s?.size ?? 0,
      mtime: s?.mtime?.toISOString?.() ?? null,
      mod_time: s?.mtime?.toISOString?.() ?? null,
    };
  }));

  json(res, 200, rows
    .filter((row) => row.type === 'directory' || IMAGE_RE.test(row.name) || /\.pdf$/i.test(row.name))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return String(b.mtime || '').localeCompare(String(a.mtime || ''));
    }));
}

async function handleFile(req, res, url) {
  const { rootKey, relPath } = splitApiPath(url.pathname, '/file');
  const root = effectiveRoot(req, rootKey);
  if (!root) return json(res, 404, { ok: false, error: 'unknown root' });
  const target = resolveInside(root, relPath);
  if (!target) return json(res, 403, { ok: false, error: 'forbidden path' });

  if (req.method === 'GET' || req.method === 'HEAD') {
    const s = await stat(target).catch(() => null);
    if (s?.isDirectory()) {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end();
      }
      return listDirectory(res, target);
    }
    if (!s?.isFile()) return json(res, 404, { ok: false, error: 'file not found' });
    const headers = {
      'content-type': contentTypeFor(target),
      'content-length': String(s.size),
      'cache-control': IMAGE_RE.test(target)
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=600',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return pipeline(createReadStream(target), res);
  }

  if (req.method === 'PUT') {
    if (!WRITE_RE.test(target)) return json(res, 400, { ok: false, error: 'file type not allowed' });
    const length = Number(req.headers['content-length'] || 0);
    if (length > MAX_UPLOAD_BYTES) return json(res, 413, { ok: false, error: 'file too large' });
    await mkdir(resolve(target, '..'), { recursive: true });
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) req.destroy(new Error('file too large'));
    });
    try {
      await pipeline(req, createWriteStream(target));
      return json(res, 201, { ok: true, root: rootKey, path: relPath, bytes: total });
    } catch (err) {
      return json(res, 500, { ok: false, error: err instanceof Error ? err.message : 'write failed' });
    }
  }

  if (req.method === 'DELETE') {
    await rm(target, { force: true }).catch(() => undefined);
    return json(res, 200, { ok: true, root: rootKey, path: relPath });
  }

  res.setHeader('allow', 'GET, HEAD, PUT, DELETE');
  return json(res, 405, { ok: false, error: 'method not allowed' });
}

async function handleThumb(req, res, url) {
  const { rootKey, relPath } = splitApiPath(url.pathname, '/thumb');
  const root = effectiveRoot(req, rootKey);
  if (!root) return json(res, 404, { ok: false, error: 'unknown root' });
  const target = resolveInside(root, relPath);
  if (!target || !IMAGE_RE.test(target)) return json(res, 404, { ok: false, error: 'image not found' });

  const width = Math.min(Math.max(Number(url.searchParams.get('w') || 320), 64), 1600);
  try {
    const sharp = (await import('sharp')).default;
    const body = await sharp(target).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    res.writeHead(200, {
      'content-type': 'image/webp',
      'content-length': String(body.length),
      'cache-control': 'public, max-age=31536000, immutable',
    });
    return res.end(body);
  } catch {
    const s = await stat(target).catch(() => null);
    if (!s?.isFile()) return json(res, 404, { ok: false, error: 'image not found' });
    res.writeHead(200, {
      'content-type': contentTypeFor(target),
      'content-length': String(s.size),
      'cache-control': 'public, max-age=3600',
    });
    return pipeline(createReadStream(target), res);
  }
}

function relPathFromPhotoUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  const noQuery = value.split('?')[0];
  const prefixes = ['/api/nas/', '/api/nas-dev/'];
  for (const prefix of prefixes) {
    if (noQuery.startsWith(prefix)) return decodeSegment(noQuery.slice(prefix.length));
  }
  try {
    const u = new URL(noQuery);
    return decodeSegment(u.pathname.replace(/^\/+/, ''));
  } catch {
    return decodeSegment(noQuery.replace(/^\/+/, ''));
  }
}

async function readPhotoBytes(rawUrl) {
  const rel = relPathFromPhotoUrl(rawUrl);
  const target = resolveInside(ROOTS.receiving, rel);
  if (target) {
    const s = await stat(target).catch(() => null);
    if (s?.isFile()) {
      return {
        stream: createReadStream(target),
        filename: basename(target) || 'photo.jpg',
      };
    }
  }

  if (/^https?:\/\//i.test(String(rawUrl || ''))) {
    const res = await fetch(rawUrl);
    if (!res.ok || !res.body) return null;
    return {
      stream: res.body,
      filename: basename(new URL(rawUrl).pathname) || 'photo.jpg',
    };
  }

  return null;
}

async function handleArchive(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { ok: false, error: 'invalid JSON' });
  }

  const ticketId = String(body.ticketId || '').replace(/^#/, '').trim();
  if (!ticketId) return json(res, 400, { ok: false, error: 'ticketId is required' });
  const archiveRoot = requestRootPath(body.archiveRoot, ROOTS.claims);
  const archiveFolder = String(body.archiveFolder || '').trim().replace(/^\/+|\/+$/g, '');
  const folder = resolveInside(archiveRoot, archiveFolder ? `${archiveFolder}/${ticketId}` : ticketId);
  if (!folder) return json(res, 403, { ok: false, error: 'forbidden archive path' });

  await mkdir(folder, { recursive: true });

  const photos = Array.isArray(body.photos) ? body.photos : [];
  let copied = 0;
  const used = new Set();
  for (const photo of photos) {
    const source = await readPhotoBytes(photo?.url);
    if (!source) continue;
    let name = source.filename || `photo_${copied + 1}.jpg`;
    if (used.has(name.toLowerCase())) {
      const ext = extname(name);
      const base = ext ? name.slice(0, -ext.length) : name;
      name = `${base}_${copied + 1}${ext}`;
    }
    used.add(name.toLowerCase());
    try {
      await pipeline(source.stream, createWriteStream(join(folder, name)));
      copied++;
    } catch {
      // Keep archiving the rest of the ticket.
    }
  }

  await writeFile(join(folder, '_ticket-info.txt'), String(body.info || ''), 'utf8').catch(() => undefined);
  json(res, 200, { ok: true, folder, copied, total: photos.length });
}

async function handleTestFolder(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { ok: false, error: 'invalid JSON' });
  }
  const name = String(body.name || `TEST-${Date.now()}`).replace(/^#/, '').trim();
  const archiveRoot = requestRootPath(body.archiveRoot, ROOTS.claims);
  const archiveFolder = String(body.archiveFolder || '').trim().replace(/^\/+|\/+$/g, '');
  const folder = resolveInside(archiveRoot, archiveFolder ? `${archiveFolder}/${name}` : name);
  if (!folder) return json(res, 403, { ok: false, error: 'forbidden archive path' });
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, '_agent-test.txt'),
    `${String(body.note || 'NAS media agent test')}\n${new Date().toISOString()}\n`,
    'utf8',
  ).catch(() => undefined);
  return json(res, 200, { ok: true, folder, name });
}

async function handlePutRoots(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { ok: false, error: 'invalid JSON' });
  }
  for (const key of ['receiving', 'shipping', 'claims']) {
    if (typeof body[key] === 'string' && body[key].trim()) {
      const next = requestRootPath(body[key], ROOTS[key]);
      if (next) ROOTS[key] = next;
    }
  }
  console.log('[nas-media-agent] roots updated', ROOTS);
  return json(res, 200, { ok: true, roots: ROOTS });
}

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, roots: Object.keys(ROOTS) });
  }

  if (!authenticate(req, res)) return;

  if (url.pathname === '/roots') {
    if (req.method === 'PUT') return handlePutRoots(req, res);
    if (req.method === 'GET') return json(res, 200, { ok: true, roots: ROOTS });
  }
  if (url.pathname === '/archive' && req.method === 'POST') {
    return handleArchive(req, res);
  }
  if (url.pathname === '/test-folder' && req.method === 'POST') {
    return handleTestFolder(req, res);
  }
  if (url.pathname === '/list' || url.pathname.startsWith('/list/')) {
    return handleList(req, res, url);
  }
  if (url.pathname.startsWith('/file/')) {
    return handleFile(req, res, url);
  }
  if (url.pathname.startsWith('/thumb/')) {
    return handleThumb(req, res, url);
  }

  return text(res, 404, 'not found\n');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error('[nas-media-agent]', err);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal error' });
    else res.destroy(err);
  });
});

server.listen(PORT, () => {
  const here = fileURLToPath(import.meta.url);
  console.log(`[nas-media-agent] listening on :${PORT}`);
  console.log(`[nas-media-agent] script=${here}`);
  console.log(`[nas-media-agent] roots=${JSON.stringify(ROOTS)}`);
});
