#!/usr/bin/env node
/**
 * USAV-fallback guard — CI gate against the single-tenant org fallback regrowing.
 *
 * Fails when 'USAV_ORG_ID' or 'transitionalUsavOrgId' appears in any file under
 * src/app/api/** that is NOT in the allowlist below. House law
 * (.claude/rules/backend-patterns.md): orgId comes from ctx (withAuth), never
 * from the body and never via a hardcoded USAV fallback — new routes must not
 * import USAV_ORG_ID or add `?? USAV_ORG_ID`.
 *
 * The allowlist is a BURN-DOWN of the known legacy offenders at authoring time
 * (2026-07-09). Only ever LOWER it (delete entries as routes are org-scoped) —
 * NEVER grow it. A new route needing an org id gets it from ctx.organizationId.
 *
 * Usage:
 *   node scripts/usav-fallback-guard.mjs   # exit 1 on non-allowlisted offenders
 *
 * package.json:
 *   npm run tenancy:usav-guard
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = join(repoRoot, 'src', 'app', 'api');

const TOKENS = ['USAV_ORG_ID', 'transitionalUsavOrgId'];

// BURN-DOWN allowlist — the offenders that existed when this guard was written.
// LOWER this list as routes get org-scoped; NEVER add to it.
//
// One sanctioned exception to "never add" (2026-07-10): the two need-to-order
// routes below were ALWAYS session-less legacy debt, but it was invisible —
// they called replenishment fns whose orgId defaulted to the UNSCOPED pool.
// The Wave-3 org-require refactor made orgId mandatory and routed them through
// the explicit transitionalUsavOrgId() service-org bridge, which made the debt
// greppable (a strict tenancy improvement). They join the ledger; the real fix
// is an internal-token→org mapping.
const ALLOWLIST = new Set([
  'src/app/api/need-to-order/create-po/route.ts',
  'src/app/api/need-to-order/recalculate/route.ts',
  'src/app/api/admin/po-gmail/create-zoho-draft/[id]/route.ts',
  'src/app/api/admin/po-gmail/triage/[id]/extract/route.ts',
  'src/app/api/auth/pin/create/route.ts',
  'src/app/api/auth/staff-picker/route.ts',
  'src/app/api/auth/switch/route.ts',
  'src/app/api/cron/zoho/orders-ingest-drain/route.ts',
  'src/app/api/ebay/refresh-tokens/route.ts',
  'src/app/api/ecwid/sync-exception-tracking/route.ts',
  'src/app/api/import-orders/route.ts',
  'src/app/api/locations/[barcode]/route.ts',
  'src/app/api/locations/[barcode]/swap/route.ts',
  'src/app/api/orders/import-csv/route.ts',
  'src/app/api/post-multi-sn/route.ts',
  'src/app/api/receiving-entry/route.ts',
  'src/app/api/receiving-logs/route.ts',
  'src/app/api/receiving/po/[poId]/attach-box/route.ts',
  'src/app/api/receiving/zendesk-claim/link/route.ts',
  'src/app/api/repair-service/pickup/route.ts',
  'src/app/api/repair-service/repaired/route.ts',
  'src/app/api/repair-service/route.ts',
  'src/app/api/repair/actions/[id]/route.ts',
  'src/app/api/repair/actions/route.ts',
  'src/app/api/repair/submit/route.ts',
  'src/app/api/sync-sheets/route.ts',
  'src/app/api/zoho/find-po/route.ts',
  'src/app/api/zoho/fulfillment-sync/route.ts',
  'src/app/api/zoho/items/[id]/image/route.ts',
  'src/app/api/zoho/orders/ingest/route.ts',
  'src/app/api/zoho/purchase-orders/receive/route.ts',
]);

function walk(dir, out = []) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) {
      if (ent === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(ent)) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
const seen = new Set();

for (const file of walk(apiRoot)) {
  const rel = relative(repoRoot, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const hits = TOKENS.filter((t) => text.includes(t));
  if (hits.length === 0) continue;
  seen.add(rel);
  if (!ALLOWLIST.has(rel)) violations.push({ file: rel, tokens: hits });
}

// Cleaned-up allowlist entries are a nudge, not a failure — lower the list.
const stale = [...ALLOWLIST].filter((f) => !seen.has(f)).sort();

if (violations.length > 0) {
  console.error(`✖ usav-fallback-guard: ${violations.length} NEW offender(s) outside the allowlist:\n`);
  for (const v of violations) {
    console.error(`  • ${v.file} → ${v.tokens.join(', ')}`);
  }
  console.error(
    '\nFix: take orgId from ctx.organizationId (withAuth) — never import USAV_ORG_ID or add\n' +
      "`?? USAV_ORG_ID` in a route (.claude/rules/backend-patterns.md). The allowlist in\n" +
      'scripts/usav-fallback-guard.mjs is a burn-down of legacy offenders only — never grow it.',
  );
  process.exit(1);
}

if (stale.length > 0) {
  console.log(
    `✓ usav-fallback-guard: OK (${seen.size} known offender(s)). ${stale.length} allowlist ` +
      'entry(ies) are now clean — LOWER the list in scripts/usav-fallback-guard.mjs:',
  );
  for (const f of stale) console.log(`  • ${f}`);
} else {
  console.log(`✓ usav-fallback-guard: OK (${seen.size} known offender(s), allowlist=${ALLOWLIST.size}).`);
}
process.exit(0);
