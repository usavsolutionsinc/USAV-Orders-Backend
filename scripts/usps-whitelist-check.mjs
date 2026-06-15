// One-off, read-only USPS access probe. Answers "are we authorized/whitelisted
// for the production Tracking API yet?" — a 403 means NO, a 200/404 means we're
// through auth. Does NOT create any subscription (no mutation).
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let [, k, v] = m;
      v = v.replace(/^['"]|['"]$/g, '');
      if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
    }
  } catch {}
}
loadEnv('.env.local');
loadEnv('.env');

const BASE = process.env.USPS_BASE_URL ?? 'https://apis.usps.com';
const id = process.env.CONSUMER_KEY || process.env.USPS_CONSUMER_KEY || process.env.USPS_CLIENT_ID;
const secret = process.env.CONSUMER_SECRET || process.env.USPS_CONSUMER_SECRET || process.env.USPS_CLIENT_SECRET;

console.log('USPS base   :', BASE);
console.log('CONSUMER_KEY:', id ? id.slice(0, 6) + '…(' + id.length + ' chars)' : 'MISSING');
console.log('SECRET      :', secret ? 'set (' + secret.length + ' chars)' : 'MISSING');
if (!id || !secret) { console.log('\n→ Credentials missing; cannot test.'); process.exit(1); }

// 1) Pull a real recent USPS tracking number from the DB (best-effort).
let trk = process.argv[2] || null;
if (!trk && process.env.DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT tracking_number_raw FROM shipping_tracking_numbers
       WHERE UPPER(COALESCE(carrier,'')) = 'USPS' AND COALESCE(tracking_number_raw,'') <> ''
       ORDER BY updated_at DESC NULLS LAST LIMIT 1`
    );
    trk = r.rows[0]?.tracking_number_raw ?? null;
    await client.end();
  } catch (e) { console.log('(DB lookup skipped:', e.message + ')'); }
}
if (!trk) trk = '9400100000000000000000'; // fallback probe number
console.log('Test number :', trk, '\n');

// 2) OAuth client-credentials token.
const authRes = await fetch(`${BASE}/oauth2/v3/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
});
const authText = await authRes.text();
console.log('AUTH  status:', authRes.status, authRes.statusText);
let token = null;
try {
  const j = JSON.parse(authText);
  token = j.access_token;
  console.log('AUTH  scope :', j.scope ?? '(none returned)');
  console.log('AUTH  expires:', j.expires_in, 'sec');
} catch { console.log('AUTH  body  :', authText.slice(0, 400)); }
if (!token) { console.log('\n→ Could not obtain a token — credentials rejected (not the whitelist).'); process.exit(2); }

// 3) Read-only tracking lookup — the whitelist signal.
const trkRes = await fetch(
  `${BASE}/tracking/v3/tracking/${encodeURIComponent(String(trk).replace(/\s+/g, ''))}?expand=DETAIL`,
  { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
);
const trkText = await trkRes.text();
console.log('\nTRACK status:', trkRes.status, trkRes.statusText);
console.log('TRACK body  :', trkText.slice(0, 600));

console.log('\n──────── VERDICT ────────');
if (trkRes.status === 403) {
  console.log('❌ NOT whitelisted yet — USPS returned 403 (access not authorized for the Tracking API).');
} else if (trkRes.status === 200 || trkRes.status === 404) {
  console.log('✅ Authorized — you are through USPS access control (Tracking API accepts our requests).');
  if (trkRes.status === 404) console.log('   (404 just means that sample number was not found; auth/whitelist is fine.)');
} else if (trkRes.status === 429) {
  console.log('⚠️  Authorized but rate-limited (429) — whitelist is fine, just throttled.');
} else {
  console.log('❓ Inconclusive — status', trkRes.status, '— see body above.');
}
