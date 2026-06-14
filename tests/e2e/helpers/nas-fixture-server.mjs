/**
 * Minimal no-auth NAS file server used ONLY as the /api/nas proxy upstream in
 * e2e. It stands in for the office NAS/agent so the proxy's full CRUD can be
 * exercised against the REAL test photos without the Cloudflare tunnel or the
 * (not-yet-deployed) office write verb.
 *
 * Speaks exactly what src/lib/nas-photos.ts expects:
 *   • GET <dir>/   → nginx-autoindex JSON: [{ name, type, size, mtime }]
 *   • GET <file>   → raw image bytes (image/* content-type)
 *   • PUT <file>   → write bytes (201)
 *   • DELETE <file>→ remove (204; 404 already-gone is success)
 *
 *   NAS_FIXTURE_ROOT="/Volumes/USAV Media/Puchasing photos/2026" \
 *   NAS_FIXTURE_PORT=8899  node tests/e2e/helpers/nas-fixture-server.mjs
 */
import http from 'node:http';
import { stat, readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, resolve, sep, extname, dirname } from 'node:path';

const ROOT = resolve(process.env.NAS_FIXTURE_ROOT || '/Volumes/USAV Media/Puchasing photos/2026');
const PORT = Number(process.env.NAS_FIXTURE_PORT || 8899);
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function targetFor(reqUrl) {
  const rel = decodeURIComponent(new URL(reqUrl, 'http://x').pathname).replace(/^\/+/, '');
  const target = resolve(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null; // traversal guard
  return target;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const target = targetFor(req.url);
  if (!target) { res.writeHead(403).end('forbidden'); return; }

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const info = await stat(target).catch(() => null);
      if (!info) { res.writeHead(404).end('not found'); return; }
      if (info.isDirectory()) {
        const names = await readdir(target);
        const entries = [];
        for (const name of names) {
          if (name.startsWith('.') || name === 'Thumbs.db') continue;
          const s = await stat(join(target, name)).catch(() => null);
          if (!s) continue;
          const isDir = s.isDirectory();
          if (!isDir && !IMAGE_RE.test(name)) continue;
          entries.push({ name, type: isDir ? 'directory' : 'file', size: s.size, mtime: s.mtime.toISOString() });
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(entries));
        return;
      }
      const buf = await readFile(target);
      res.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : buf);
      return;
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      res.writeHead(201).end();
      return;
    }

    if (req.method === 'DELETE') {
      await unlink(target).catch((e) => { if (e.code !== 'ENOENT') throw e; });
      res.writeHead(204).end();
      return;
    }

    res.writeHead(405).end('method not allowed');
  } catch (err) {
    res.writeHead(500).end(String(err?.message || err));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[nas-fixture] http://127.0.0.1:${PORT} root=${ROOT}`));
