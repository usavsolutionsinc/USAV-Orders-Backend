#!/usr/bin/env node
/**
 * Read-only Zendesk API smoke test via app routes (no ticket creation).
 * Run: node scripts/zendesk-api-smoke.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { Pool } from 'pg';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const cookieJar = new Map();

function parseSetCookie(setCookie) {
  if (!setCookie) return;
  const parts = String(setCookie).split(';')[0].split('=');
  if (parts.length >= 2) cookieJar.set(parts[0], parts.slice(1).join('='));
}

async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (cookieJar.size) headers.Cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  parseSetCookie(res.headers.get('set-cookie'));
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function main() {
  const signin = await api('POST', '/api/auth/signin', { staffId: 1, deviceKind: 'personal' });
  if (signin.status !== 200 || !signin.json?.ok) {
    console.error('FAIL signin', signin.status, signin.json);
    process.exit(1);
  }
  console.log('✓ signin as', signin.json.name);

  const list = await api('GET', '/api/zendesk/tickets?perPage=1');
  console.log(list.status === 200 && list.json.success ? '✓ GET /api/zendesk/tickets' : `✗ GET tickets ${list.status} ${list.json.error || ''}`);

  const search = await api('GET', '/api/zendesk/tickets?query=status%3Copen&perPage=1');
  console.log(search.status === 200 && search.json.success ? '✓ GET /api/zendesk/tickets (search)' : `✗ search ${search.status} ${search.json.error || ''}`);

  const ticketId = list.json?.tickets?.[0]?.id ?? search.json?.tickets?.[0]?.id;
  if (ticketId) {
    for (const [label, path] of [
      ['ticket detail', `/api/zendesk/tickets/${ticketId}`],
      ['comments', `/api/zendesk/tickets/${ticketId}/comments`],
      ['photos', `/api/zendesk/tickets/${ticketId}/photos`],
      ['assign', `/api/zendesk/tickets/${ticketId}/assign`],
    ]) {
      const r = await api('GET', path);
      console.log(r.status === 200 && r.json.success ? `✓ GET ${label}` : `✗ GET ${label} ${r.status} ${r.json.error || ''}`);
    }
  } else {
    console.log('~ skip ticket detail (no tickets in list)');
  }

  const agents = await api('GET', '/api/zendesk/agents');
  console.log(agents.status === 200 && agents.json.success ? `✓ GET agents (${agents.json.agents?.length ?? 0})` : `✗ agents ${agents.status} ${agents.json.error || ''}`);

  const overview = await api('GET', '/api/support/overview');
  console.log(overview.status === 200 && overview.json.success ? '✓ GET /api/support/overview' : `✗ overview ${overview.status} ${overview.json.error || ''}`);

  // Claim dry-run — assembles payload, creates nothing in Zendesk/DB.
  let receivingId = Number(process.env.SMOKE_RECEIVING_ID) || 0;
  if (!receivingId) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const q = await pool.query('SELECT id FROM receiving ORDER BY id DESC LIMIT 1');
      receivingId = Number(q.rows[0]?.id) || 0;
    } finally {
      await pool.end();
    }
  }
  if (receivingId) {
    const dry = await api('POST', '/api/receiving/zendesk-claim', {
      receivingId,
      claimType: 'damage',
      reason: 'API smoke dry-run',
      dryRun: true,
    });
    console.log(
      dry.status === 200 && dry.json.success && dry.json.dryRun
        ? `✓ POST zendesk-claim dryRun (#${dry.json.ticketNumber})`
        : `✗ dryRun ${dry.status} ${dry.json.error || JSON.stringify(dry.json).slice(0, 120)}`,
    );
  } else {
    console.log('~ skip claim dryRun (no receiving row)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
