#!/usr/bin/env node
/**
 * Tenancy coverage generator (Phase A1).
 *
 * Connects to DATABASE_URL and produces the GROUND-TRUTH inventory of every
 * base table's tenant-isolation state — straight from the live catalog, not
 * from schema.ts (which has drifted). Output:
 *
 *   docs/tenancy/org-id-coverage.generated.md   (human triage doc)
 *   docs/tenancy/coverage.generated.json        (machine sidecar for the route audit)
 *
 * For each table it records:
 *   - has organization_id, NOT NULL, the column DEFAULT (and its "kind")
 *   - RLS enabled / FORCEd, whether a tenant_isolation policy exists
 *   - FK to organizations(id)?  approximate row count
 *   - the table's FK parents (to suggest child-scoped isolation)
 *   - a HEURISTIC classification (tenant-owned / global-reference / child-scoped
 *     / system) — a starting point for the human decision in Phase B1.
 *
 * Re-run any time: `node scripts/tenancy-coverage.mjs`
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

try {
  const { config } = await import('dotenv');
  config({ path: join(repoRoot, '.env.local') });
  config({ path: join(repoRoot, '.env') });
} catch {
  /* dotenv optional */
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const USAV = '00000000-0000-0000-0000-000000000001';

// Tables that are intentionally GLOBAL / system — NOT tenant-scoped. Document
// the reason; never run enforce_tenant_isolation() on these.
const SYSTEM_GLOBAL = new Map([
  ['schema_migrations', 'migration ledger (infra)'],
  ['cron_runs', 'cron execution log (infra; could add org for per-tenant crons later)'],
  ['config', 'global app config / kill-switches'],
  ['admin_features', 'global feature-definition catalog'],
  ['organizations', 'the tenant root table itself'],
  ['organization_integrations', 'already keyed by organization_id as PK part (per-tenant vault)'],
  ['stripe_events', 'global Stripe webhook idempotency log'],
  ['roles', 'global system roles (no per-org roles yet — see Phase F3)'],
  ['staff_roles', 'staff↔role link; isolation rides on staff.organization_id'],
]);

// Reference taxonomies that *might* be intentionally global (shared knowledge)
// — flagged for an explicit Phase B1 decision rather than auto-classified.
const REFERENCE_CANDIDATES = new Set([
  'bose_models', 'bose_serial_prefixes', 'part_compatibility', 'failure_modes',
  'available_sku_suffixes', 'return_dispositions',
]);

function defaultKind(def) {
  if (!def) return 'none';
  if (def.includes(`'${USAV}'`) || def.toLowerCase().includes('coalesce')) return 'usav-fallback';
  if (def.includes("current_setting('app.current_org'")) return 'loud-fail';
  return 'other';
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

const inventory = (await pool.query(`
  SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced,
    (a.attname IS NOT NULL) AS has_org,
    COALESCE(a.attnotnull, false) AS org_notnull,
    pg_get_expr(ad.adbin, ad.adrelid) AS org_default,
    COALESCE(c.reltuples::bigint, 0) AS approx_rows,
    EXISTS (
      SELECT 1 FROM pg_constraint k
      WHERE k.conrelid = c.oid AND k.contype = 'f'
        AND k.confrelid = 'organizations'::regclass
    ) AS fk_to_orgs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname;
`)).rows;

const policies = (await pool.query(`
  SELECT tablename, count(*) FILTER (WHERE policyname LIKE '%tenant_isolation%') AS iso,
         count(*) FILTER (WHERE policyname = 'hermes_agent_read') AS hermes
  FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename;
`)).rows;
const polByTable = new Map(policies.map((p) => [p.tablename, p]));

// FK parents per child (excluding self-refs and the organizations table).
const fks = (await pool.query(`
  SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE c.contype = 'f' AND n.nspname = 'public';
`)).rows;
const parentsByChild = new Map();
for (const { child, parent } of fks) {
  if (parent === child || parent === 'organizations') continue;
  if (!parentsByChild.has(child)) parentsByChild.set(child, new Set());
  parentsByChild.get(child).add(parent);
}

const orgTables = new Set(inventory.filter((r) => r.has_org).map((r) => r.table_name));

function classify(r) {
  if (SYSTEM_GLOBAL.has(r.table_name)) return 'system-global';
  if (REFERENCE_CANDIDATES.has(r.table_name)) return 'reference-decide';
  if (r.has_org) return 'tenant-owned';
  // No org_id. Child-scoped if every FK parent is a tenant table.
  const parents = [...(parentsByChild.get(r.table_name) || [])];
  const tenantParents = parents.filter((p) => orgTables.has(p));
  if (tenantParents.length) return `child-scoped(${tenantParents.join(',')})`;
  return 'tenant-owned-NEEDS-COL';
}

const rows = inventory.map((r) => ({
  table: r.table_name,
  classification: classify(r),
  has_org: r.has_org,
  not_null: r.org_notnull,
  default_kind: defaultKind(r.org_default),
  fk_to_orgs: r.fk_to_orgs,
  rls_enabled: r.rls_enabled,
  rls_forced: r.rls_forced,
  has_iso_policy: (polByTable.get(r.table_name)?.iso ?? 0) > 0,
  hermes_read: (polByTable.get(r.table_name)?.hermes ?? 0) > 0,
  approx_rows: Number(r.approx_rows),
  fk_parents: [...(parentsByChild.get(r.table_name) || [])],
}));

const sum = {
  total: rows.length,
  with_org: rows.filter((r) => r.has_org).length,
  org_not_null: rows.filter((r) => r.not_null).length,
  rls_enabled: rows.filter((r) => r.rls_enabled).length,
  rls_forced: rows.filter((r) => r.rls_forced).length,
  has_iso_policy: rows.filter((r) => r.has_iso_policy).length,
  needs_col: rows.filter((r) => r.classification === 'tenant-owned-NEEDS-COL').length,
  child_scoped: rows.filter((r) => r.classification.startsWith('child-scoped')).length,
  reference_decide: rows.filter((r) => r.classification === 'reference-decide').length,
  system_global: rows.filter((r) => r.classification === 'system-global').length,
  usav_fallback_default: rows.filter((r) => r.default_kind === 'usav-fallback').length,
};

// ── machine sidecar ────────────────────────────────────────────────────────
mkdirSync(join(repoRoot, 'docs/tenancy'), { recursive: true });
writeFileSync(
  join(repoRoot, 'docs/tenancy/coverage.generated.json'),
  JSON.stringify({ generatedFrom: 'live DB (pg_catalog)', summary: sum, tables: rows }, null, 2),
);

// ── human doc ──────────────────────────────────────────────────────────────
const tf = (b) => (b ? '✅' : '—');
const lines = [];
lines.push('# Tenancy org_id + RLS coverage — GENERATED');
lines.push('');
lines.push('> Source of truth: **the live database catalog** (`pg_class` / `pg_attribute` / `pg_policies`),');
lines.push('> not `schema.ts`. Regenerate with `node scripts/tenancy-coverage.mjs`. Do not hand-edit.');
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`| metric | count |`);
lines.push(`|---|---|`);
lines.push(`| base tables | ${sum.total} |`);
lines.push(`| with \`organization_id\` | ${sum.with_org} |`);
lines.push(`| \`organization_id NOT NULL\` | ${sum.org_not_null} |`);
lines.push(`| RLS enabled | ${sum.rls_enabled} |`);
lines.push(`| **RLS FORCEd** | **${sum.rls_forced}** |`);
lines.push(`| has tenant_isolation policy | ${sum.has_iso_policy} |`);
lines.push(`| still on USAV-fallback default (footgun) | ${sum.usav_fallback_default} |`);
lines.push(`| tenant-owned, **missing org_id col** | ${sum.needs_col} |`);
lines.push(`| child-scoped (FK to a tenant parent) | ${sum.child_scoped} |`);
lines.push(`| reference — needs explicit decision | ${sum.reference_decide} |`);
lines.push(`| system/global (never enforce) | ${sum.system_global} |`);
lines.push('');
lines.push('## Per-table');
lines.push('');
lines.push('Legend: org=has organization_id · NN=NOT NULL · dflt=default kind · FK=FK→organizations · RLS=enabled · FORCE=forced · pol=tenant_isolation policy present · hermes=hermes_agent_read policy.');
lines.push('');
lines.push('| table | classification | org | NN | dflt | FK | RLS | FORCE | pol | hermes | ~rows |');
lines.push('|---|---|:-:|:-:|---|:-:|:-:|:-:|:-:|:-:|--:|');
for (const r of rows.sort((a, b) => a.classification.localeCompare(b.classification) || a.table.localeCompare(b.table))) {
  lines.push(
    `| \`${r.table}\` | ${r.classification} | ${tf(r.has_org)} | ${tf(r.not_null)} | ${r.default_kind} | ${tf(r.fk_to_orgs)} | ${tf(r.rls_enabled)} | ${tf(r.rls_forced)} | ${tf(r.has_iso_policy)} | ${tf(r.hermes_read)} | ${r.approx_rows < 0 ? '?' : r.approx_rows} |`,
  );
}
lines.push('');
writeFileSync(join(repoRoot, 'docs/tenancy/org-id-coverage.generated.md'), lines.join('\n'));

console.log(JSON.stringify(sum, null, 2));
console.log('wrote docs/tenancy/org-id-coverage.generated.md + coverage.generated.json');
await pool.end();
