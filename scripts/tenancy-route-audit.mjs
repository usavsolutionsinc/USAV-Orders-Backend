#!/usr/bin/env node
/**
 * Route scoping audit (Phase A2).
 *
 * Static scan of every src/app/api/**\/route.ts. For each handler it detects:
 *   - HTTP methods exported, withAuth wrap + permission
 *   - whether it references organizationId (ctx-scoped intent)
 *   - whether it uses the tenant GUC wrappers (tenantQuery/withTenantConnection/
 *     withTenantTransaction) vs the raw @/lib/db pool vs drizzle neon-http
 *   - whether it touches transitional escape hatches (USAV_ORG_ID/transitionalUsavOrgId)
 *   - which TENANT tables it references (word-boundary match against the live
 *     tenant-table set from coverage.generated.json)
 *   - a risk rating
 *
 * Outputs:
 *   docs/tenancy/route-scoping-audit.generated.md
 *   docs/tenancy/route-audit.generated.json
 *   plus a per-tenant-table REVERSE INDEX (table -> routes touching it) — the
 *   gate for Phase E: a table may only be enforced once every route in its
 *   list is GUC-scoped.
 *
 * Re-run: `node scripts/tenancy-route-audit.mjs`
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const apiRoot = join(repoRoot, 'src/app/api');

const coveragePath = join(repoRoot, 'docs/tenancy/coverage.generated.json');
if (!existsSync(coveragePath)) {
  console.error('Run scripts/tenancy-coverage.mjs first (need coverage.generated.json)');
  process.exit(1);
}
const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
// "tenant data" tables = anything not system-global. Child-scoped + reference
// included because a leak through them is still a cross-tenant leak.
const tenantTables = new Set(
  coverage.tables.filter((t) => t.classification !== 'system-global').map((t) => t.table),
);
// Longest first so multi-word names match before their prefixes.
const tableList = [...tenantTables].sort((a, b) => b.length - a.length);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

function routePath(file) {
  const rel = relative(apiRoot, dirname(file));
  return '/api/' + rel.split('/').map((s) => s).join('/');
}

const files = walk(apiRoot);
const records = [];
const reverse = new Map(); // table -> Set(routePath)

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const methods = [...src.matchAll(/export\s+(?:const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  const uniqMethods = [...new Set(methods)];
  const withAuth = /withAuth\s*\(/.test(src);
  const permMatch = src.match(/permission:\s*['"]([^'"]+)['"]/);
  const orgIdRef = /organizationId/.test(src);
  const tenantWrapped = /\b(tenantQuery|withTenantConnection|withTenantTransaction)\b/.test(src);
  const rawPool = /from\s+['"]@\/lib\/db['"]/.test(src);
  const drizzle = /from\s+['"]@\/lib\/drizzle|neon-http/.test(src);
  const transitional = /\b(USAV_ORG_ID|transitionalUsavOrgId)\b/.test(src);
  const rp = routePath(file);
  const isCron = rp.startsWith('/api/cron');
  const isPathParam = /\[[^\]]+\]/.test(rp);
  const mutates = uniqMethods.some((m) => m !== 'GET' && m !== 'HEAD');

  const touched = [];
  for (const t of tableList) {
    const re = new RegExp(`\\b${t}\\b`);
    if (re.test(src)) touched.push(t);
  }
  const touchedSet = new Set(touched);
  for (const t of touchedSet) {
    if (!reverse.has(t)) reverse.set(t, new Set());
    reverse.get(t).add(rp);
  }

  // ── risk ──
  let risk = 'n/a';
  const touchesTenant = touchedSet.size > 0;
  if (touchesTenant) {
    if (tenantWrapped) risk = 'low';
    else if (mutates && !orgIdRef) risk = 'critical';
    else if (!orgIdRef) risk = 'high';
    else risk = 'medium'; // has org filter intent but no GUC/RLS backstop
  } else {
    risk = 'info';
  }
  // path-param mutations without an ownership filter are always at least high
  if (touchesTenant && isPathParam && mutates && !tenantWrapped && !orgIdRef) risk = 'critical';

  records.push({
    route: rp,
    methods: uniqMethods,
    withAuth,
    permission: permMatch ? permMatch[1] : null,
    orgIdRef,
    tenantWrapped,
    rawPool,
    drizzle,
    transitional,
    isCron,
    isPathParam,
    mutates,
    touched: [...touchedSet],
    risk,
  });
}

const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4, 'n/a': 5 };
records.sort((a, b) => rank[a.risk] - rank[b.risk] || a.route.localeCompare(b.route));

const counts = records.reduce((m, r) => ((m[r.risk] = (m[r.risk] || 0) + 1), m), {});
const summary = {
  total: records.length,
  withAuth: records.filter((r) => r.withAuth).length,
  tenantWrapped: records.filter((r) => r.tenantWrapped).length,
  orgIdRef: records.filter((r) => r.orgIdRef).length,
  rawPool: records.filter((r) => r.rawPool).length,
  drizzle: records.filter((r) => r.drizzle).length,
  transitional: records.filter((r) => r.transitional).length,
  cron: records.filter((r) => r.isCron).length,
  byRisk: counts,
};

writeFileSync(
  join(repoRoot, 'docs/tenancy/route-audit.generated.json'),
  JSON.stringify({ summary, routes: records }, null, 2),
);

const tf = (b) => (b ? '✅' : '—');
const L = [];
L.push('# Route scoping audit — GENERATED');
L.push('');
L.push('> Static scan of `src/app/api/**/route.ts`. Regenerate: `node scripts/tenancy-route-audit.mjs`.');
L.push('> "touches tenant table" = the handler body word-matches a non-system table from the coverage doc.');
L.push('> Risk: **critical** = mutates a tenant table with no org filter & no GUC; **high** = reads one with no');
L.push('> org filter & no GUC; **medium** = has an org filter but no GUC/RLS backstop; **low** = GUC-wrapped.');
L.push('');
L.push('## Summary');
L.push('');
L.push(`| metric | count |`);
L.push(`|---|---|`);
L.push(`| total route files | ${summary.total} |`);
L.push(`| withAuth | ${summary.withAuth} |`);
L.push(`| GUC-wrapped (tenantQuery/withTenantConnection/withTenantTransaction) | ${summary.tenantWrapped} |`);
L.push(`| references organizationId | ${summary.orgIdRef} |`);
L.push(`| raw @/lib/db pool import | ${summary.rawPool} |`);
L.push(`| drizzle / neon-http | ${summary.drizzle} |`);
L.push(`| uses USAV_ORG_ID / transitionalUsavOrgId | ${summary.transitional} |`);
L.push(`| cron routes | ${summary.cron} |`);
L.push('');
L.push('| risk | count |');
L.push('|---|---|');
for (const k of ['critical', 'high', 'medium', 'low', 'info', 'n/a']) {
  if (counts[k]) L.push(`| ${k} | ${counts[k]} |`);
}
L.push('');
L.push('## Routes by risk (critical + high first)');
L.push('');
L.push('| risk | route | methods | auth | orgRef | GUC | tables touched |');
L.push('|---|---|---|:-:|:-:|:-:|---|');
for (const r of records) {
  if (r.risk === 'info' || r.risk === 'n/a') continue;
  const t = r.touched.slice(0, 6).join(', ') + (r.touched.length > 6 ? ` +${r.touched.length - 6}` : '');
  L.push(`| ${r.risk} | \`${r.route}\` | ${r.methods.join('/') || '—'} | ${tf(r.withAuth)} | ${tf(r.orgIdRef)} | ${tf(r.tenantWrapped)} | ${t} |`);
}
L.push('');
L.push('## Reverse index — routes per tenant table (the Phase E enforcement gate)');
L.push('');
L.push('> A table may be `enforce_tenant_isolation()`-d only once **every** route below it is GUC-wrapped (low risk).');
L.push('');
const tablesSorted = [...reverse.keys()].sort();
for (const t of tablesSorted) {
  const routes = [...reverse.get(t)].sort();
  const unsafe = routes.filter((rp) => {
    const rec = records.find((x) => x.route === rp);
    return rec && rec.risk !== 'low';
  });
  L.push(`### \`${t}\` — ${routes.length} routes, ${unsafe.length} not yet GUC-safe`);
  L.push('');
  for (const rp of routes) {
    const rec = records.find((x) => x.route === rp);
    L.push(`- ${rec.risk === 'low' ? '✅' : '⛔'} \`${rp}\` (${rec.risk})`);
  }
  L.push('');
}
writeFileSync(join(repoRoot, 'docs/tenancy/route-scoping-audit.generated.md'), L.join('\n'));

console.log(JSON.stringify(summary, null, 2));
console.log('wrote docs/tenancy/route-scoping-audit.generated.md + route-audit.generated.json');
