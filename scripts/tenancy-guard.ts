/**
 * Tenancy isolation guard (CI gate).
 *
 * Two self-activating invariants. Both PASS today (no table is enforced yet)
 * and start FAILING the moment a regression is introduced — so they can be
 * wired into CI now and tighten automatically as Phase E rolls out.
 *
 *   (A) Static enforcement gate (no DB needed):
 *       For every table that is FORCEd (from docs/tenancy/coverage.generated.json),
 *       EVERY route that touches it (docs/tenancy/route-audit.generated.json
 *       reverse index) must be GUC-wrapped (risk 'low'). If a raw-pool route
 *       touches an enforced table it would silently get zero rows in prod —
 *       fail the build instead.
 *
 *   (B) Live role invariant (needs a DB URL):
 *       If ANY table is FORCEd in the live catalog, the role that serves TENANT
 *       traffic must NOT have rolbypassrls. This mirrors the runtime two-pool
 *       split in src/lib/db.ts: the GUC wrappers run on `tenantPool`, whose DSN
 *       is TENANT_APP_DATABASE_URL if set, else it ALIASES the owner pool. So
 *       the invariant checks TENANT_APP_DATABASE_URL when present (the
 *       `app_tenant` non-bypass role) and only falls back to DATABASE_URL when
 *       the tenant DSN is unset (the dangerous alias case the app would run in).
 *       The owner pool itself having BYPASSRLS is correct-by-design post-E1
 *       (admin/cron/raw-pool paths); flagging it would be a false alarm.
 *       BYPASSRLS DEFEATS FORCE (empirically confirmed), so a bypass tenant role
 *       while tables are FORCEd ships RLS that looks on but is fully bypassed —
 *       a hard CI failure.
 *
 * Usage:
 *   npx tsx scripts/tenancy-guard.ts            # report both invariants
 *   npx tsx scripts/tenancy-guard.ts --check    # exit 1 on violation (CI)
 *   --static-only   run only (A) (no DB); --live-only run only (B) (needs a DB URL).
 *     Lets CI enforce the keystone role invariant (B) independently of the
 *     route-coverage gate (A), which over-counts until the route audit can see
 *     through helper delegation.
 *
 * Keep the generated docs fresh first:
 *   node scripts/tenancy-coverage.mjs && node scripts/tenancy-route-audit.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_TENANCY_EXEMPTIONS } from './tenancy-guard-exemptions';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const liveOnly = process.argv.includes('--live-only');
const staticOnly = process.argv.includes('--static-only');
const listExemptions = process.argv.includes('--list-exemptions');
const runStatic = !liveOnly;
const runLive = !staticOnly;

const coveragePath = join(repoRoot, 'docs/tenancy/coverage.generated.json');
const routePath = join(repoRoot, 'docs/tenancy/route-audit.generated.json');

async function main() {
try {
  const { config } = await import('dotenv');
  config({ path: join(repoRoot, '.env.local'), quiet: true });
  config({ path: join(repoRoot, '.env'), quiet: true });
} catch {
  /* dotenv optional — CI passes DATABASE_URL via env */
}

const violations: string[] = [];

// ── (A) static enforcement gate ─────────────────────────────────────────────
if (runStatic) {
  if (!existsSync(coveragePath) || !existsSync(routePath)) {
    console.error(
      'Missing generated audits. Run:\n' +
        '  node scripts/tenancy-coverage.mjs && node scripts/tenancy-route-audit.mjs',
    );
    process.exit(check ? 1 : 0);
  }

  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
    tables: { table: string; rls_forced: boolean }[];
  };
  const routeAudit = JSON.parse(readFileSync(routePath, 'utf8')) as {
    routes: { route: string; risk: string; touched: string[] }[];
  };

  const enforced = coverage.tables.filter((t) => t.rls_forced).map((t) => t.table);
  const enforcedSet = new Set(enforced);

  // A route that touches a FORCEd table on the raw owner pool would silently get
  // zero rows in prod. It clears the gate only if it is EITHER GUC-wrapped
  // (risk 'low') OR carries a documented, by-design exemption in
  // ROUTE_TENANCY_EXEMPTIONS (keyed by route path so it survives more tables
  // being FORCEd). Anything else is an unresolved violation — so the gate stays
  // a ratchet that catches NEW leaks.
  const exemptByCategory: Record<string, number> = {};
  const matchedExemptions = new Set<string>();
  const exemptLines: string[] = [];
  let staticViolations = 0;
  for (const r of routeAudit.routes) {
    if (r.risk === 'low') continue;
    const offending = r.touched.filter((t) => enforcedSet.has(t));
    if (!offending.length) continue;
    const exemption = ROUTE_TENANCY_EXEMPTIONS[r.route];
    if (exemption) {
      matchedExemptions.add(r.route);
      exemptByCategory[exemption.category] = (exemptByCategory[exemption.category] ?? 0) + 1;
      exemptLines.push(`  EXEMPT: ${exemption.category} — ${r.route} — ${exemption.reason}`);
      continue;
    }
    staticViolations++;
    violations.push(
      `route ${r.route} (risk=${r.risk}) touches ENFORCED table(s) [${offending.join(', ')}] but is not GUC-wrapped or allowlisted`,
    );
  }

  const catSummary = Object.entries(exemptByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}=${n}`)
    .join(', ');
  console.log(
    `Tenancy guard (A): ${enforced.length} enforced table(s); ` +
      `${matchedExemptions.size} documented exemption(s)${catSummary ? ` (${catSummary})` : ''}; ` +
      `${staticViolations} unresolved static violation(s).`,
  );
  if (listExemptions && exemptLines.length) {
    console.log(exemptLines.sort().join('\n'));
  }

  // Stale-exemption hygiene (non-fatal): an allowlisted route that no longer
  // matches a live violation — e.g. it was since GUC-wrapped, deleted, or its
  // table un-FORCEd — can be pruned from the allowlist.
  const stale = Object.keys(ROUTE_TENANCY_EXEMPTIONS).filter((rt) => !matchedExemptions.has(rt));
  if (stale.length) {
    console.warn(
      `Tenancy guard (A): ${stale.length} exemption(s) no longer match a live violation (safe to prune): ` +
        `${stale.slice(0, 10).join(', ')}${stale.length > 10 ? ' …' : ''}`,
    );
  }
}

// ── (B) live role invariant ─────────────────────────────────────────────────
// Check the role that serves TENANT traffic, mirroring src/lib/db.ts: the GUC
// wrappers run on tenantPool, whose DSN is TENANT_APP_DATABASE_URL if set, else
// it aliases the owner pool. The owner DSN (DATABASE_URL) being BYPASSRLS is
// correct-by-design after the two-pool split, so we must NOT flag it.
const TENANT_DSN = process.env.TENANT_APP_DATABASE_URL;
const OWNER_DSN = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const tenantRuntimeDsn = TENANT_DSN || OWNER_DSN;
const tenantDsnIsAlias = !TENANT_DSN; // app would serve tenant traffic on the owner pool
if (runLive && tenantRuntimeDsn) {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: tenantRuntimeDsn, max: 1 });
    const { rows: forced } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity`,
    );
    const forcedCount = Number(forced[0]?.n ?? 0);
    const { rows: role } = await pool.query<{ current_user: string; bypass: boolean }>(
      `SELECT current_user, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
    );
    const { current_user, bypass } = role[0]!;
    const source = tenantDsnIsAlias ? 'DATABASE_URL (tenant DSN unset → owner alias)' : 'TENANT_APP_DATABASE_URL';
    console.log(`Tenancy guard (B): tenant-runtime role '${current_user}' (bypassrls=${bypass}) via ${source}; ${forcedCount} FORCEd table(s) live.`);
    if (forcedCount > 0 && bypass) {
      violations.push(
        tenantDsnIsAlias
          ? `TENANT_APP_DATABASE_URL is unset, so tenant traffic runs on owner role '${current_user}' (BYPASSRLS) ` +
              `while ${forcedCount} table(s) are FORCEd — RLS is fully bypassed. Set TENANT_APP_DATABASE_URL to the app_tenant DSN (Phase E1).`
          : `tenant-runtime role '${current_user}' has BYPASSRLS while ${forcedCount} table(s) are FORCEd — ` +
              `FORCE is INERT for it. TENANT_APP_DATABASE_URL must point at a non-bypassrls role (Phase E1).`,
      );
    }
    await pool.end();
  } catch (err) {
    console.warn('Tenancy guard (B): live check skipped —', err instanceof Error ? err.message : err);
  }
} else if (runLive) {
  console.log('Tenancy guard (B): no DB URL set — live role invariant skipped.');
}

// ── result ──────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error('\n❌ Tenancy isolation violations:');
  for (const v of violations) console.error('  - ' + v);
  if (check) process.exit(1);
} else {
  console.log('\n✅ Tenancy isolation guard passed.');
}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
