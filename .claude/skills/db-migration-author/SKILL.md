---
name: db-migration-author
description: Author a new hand-written SQL migration in src/lib/migrations/ the canonical way — dated immutable filename, idempotent DDL (IF NOT EXISTS / guarded DO-blocks), and tenant-from-birth scoping (organization_id NOT NULL + per-org keys + enforce_tenant_isolation()). Writes the file only; hand off to /db-migrate to apply. Use when adding a table/column/index/constraint.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# DB migration author

Writes a correct migration **file**; it does NOT apply it (that's `/db-migrate`).
This split matters because the runner makes applied files immutable (below).

## The system (read before writing)

- Migrations are **hand-written SQL** in `src/lib/migrations/*.sql`, applied by
  `scripts/run-pending-migrations.mjs` (`npm run db:migrate`). This repo uses raw SQL,
  NOT Drizzle, for these — mirror the existing files.
- The runner applies files in **filename sort order** and records each in
  `schema_migrations` (filename + sha256).
- **Applied files are immutable.** If you change a file after it ran, the runner exits
  non-zero (sha mismatch). So: get it right *before* applying; any later fix is a **new**
  migration file, never an edit to the old one.
- Every migration must be **idempotent** — safe to run against both a fresh DB and an
  existing one: `CREATE TABLE/INDEX IF NOT EXISTS`, `DROP … IF EXISTS`, `ADD COLUMN IF
  NOT EXISTS`, and `DO $$ … IF EXISTS(…) THEN … END $$` guards for anything conditional.

## Step 1 — name the file

Format: `YYYY-MM-DD[letter]_snake_case_description.sql`. Use **today's date**. The whole
filename sets apply order (lexical sort). Multiple same-day files coexist fine,
distinguished by their description — you do NOT need a letter suffix just to avoid a name
clash. Add a letter suffix (`b`, `c`, …) **only when this migration must apply *after*
another same-day file** (an ordering dependency — e.g. enforce-RLS after the base table).

```bash
ls -1 src/lib/migrations/$(date +%Y-%m-%d)*.sql 2>/dev/null   # see today's existing files
# Plain description is fine: 2026-06-21_<desc>.sql
# Needs to run AFTER 2026-06-21_<base>.sql? → 2026-06-21b_<desc>.sql
```

## Step 2 — write a header comment

Open with a `--` block stating: what + why, the **safety gating** (why it's safe to apply
now — e.g. "every writer stamps organization_id / runs under the GUC"), the **rollback**
(`select relax_tenant_isolation('<table>')` for enforced tables, or the inverse DDL), and
any **verify** steps. The recent tenant migrations
(`2026-06-20b_enforce_tenant_isolation_serial_units.sql`,
`2026-06-21_staff_preferences.sql`) are the reference for tone and rigor.

## Step 3 — tenant-from-birth (new tables)

A new business table is tenant-owned unless it's global-reference/system. Copy
`templates/new-tenant-table.sql.tmpl` and:

- `organization_id UUID NOT NULL` — no default in the DDL (the helper installs the
  loud-fail GUC default).
- Every natural key / UNIQUE / index leads with `organization_id` (per-org uniqueness,
  never global — that was the serial_units bug class).
- FK children use `… REFERENCES parent(id) ON DELETE CASCADE` where appropriate.
- Then the **guarded enforce block** — flips the loud-fail `organization_id` DEFAULT
  (`NULLIF(current_setting('app.current_org', true), '')::uuid`), `ENABLE + FORCE ROW
  LEVEL SECURITY`, and the canonical `<table>_tenant_isolation` policy, all in one call:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('<table>');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — <table> left without FORCE RLS';
  END IF;
END $$;
```

(The helper lives in `2026-06-14_rls_enforcement_infra.sql`; the guard lets a fresh DB
without it still get the table.)

**Safety gate — do NOT enforce a table whose writers don't yet stamp org.** FORCE/loud-fail
only after every code path that writes the table either passes `organization_id` explicitly
or runs inside `withTenantConnection`/`withTenantTransaction` (see the `org-scope` skill).
If writers aren't ready, ship the table with a transitional USAV-fallback default instead
and enforce in a later migration once the routes are wrapped. RLS is inert under
`neondb_owner` (BYPASSRLS) regardless; the loud-fail default is the part that bites first.

## Step 4 — global-reference / system tables (the exception)

Tables that are intentionally cross-tenant (lookup/reference, or globally-shared like STN)
**skip** `organization_id` + enforce. Say so explicitly in the header comment so the next
reader (and `tenancy:coverage`) knows it's deliberate, not an omission.

## Step 5 — hand off, don't apply

- Show the file. Then tell the user to apply via **`/db-migrate`** (dry-run → confirm →
  apply). Do not run `db:migrate` from this skill, and never `db:push`.
- After it's applied, regenerate the tenancy ground-truth so the audit stays honest:
  ```bash
  npm run tenancy:coverage    # picks up the new table's org_id/RLS/FORCE state
  ```
- If the table will be read/written by routes, scope those with the **`org-scope`** skill.

## Rules

- One concern per migration; today's date; immutable once applied (fixes = new file).
- Idempotent DDL only (`IF NOT EXISTS` / guarded `DO`-blocks).
- New business tables are tenant-from-birth: `organization_id NOT NULL`, per-org keys,
  `enforce_tenant_isolation()` — but only FORCE once writers stamp org.
- Never edit an already-applied migration. Never apply from here — that's `/db-migrate`.
- Document rollback + gating in the header; mark global/system tables as deliberately unscoped.
