---
name: db-migrate
description: Safely apply pending Drizzle migrations against Neon. Always runs a dry preview first and waits for explicit user confirmation before applying.
allowed-tools: Bash, Read
disable-model-invocation: true
---

# DB Migrate (safe)

Wraps the project's existing `db:migrate` pipeline with a forced dry-run + confirmation step. Production data has burned us before — this skill exists to make the safe path the only path.

## Steps

1. **Show what's pending** — the runner (`scripts/run-pending-migrations.mjs`) applies the
   hand-written SQL files in `src/lib/migrations/*.sql` (NOT Drizzle) and tracks applied
   ones in `schema_migrations`. List the files and the untracked/new ones:
   ```bash
   ls -1 src/lib/migrations/*.sql 2>/dev/null | tail -10
   git status --short src/lib/migrations 2>/dev/null
   ```
   (The `--dry` run in step 2 is the authoritative "what's pending" — it reads
   `schema_migrations` and prints exactly which files would apply.)

2. **Dry run** — always:
   ```bash
   npm run db:migrate:dry
   ```
   Print the SQL it would execute. Stop and show it.

3. **Ask for confirmation.** Print the exact prompt:
   ```
   The above is the SQL that will run against $POSTGRES_URL.
   Reply "apply" to proceed, anything else to abort.
   ```
   Wait for the user. Do not assume.

4. **Apply** — only if the user typed `apply`:
   ```bash
   npm run db:migrate
   ```

5. **Verify** — after apply, re-run the dry-run; expect it to report zero pending:
   ```bash
   npm run db:migrate:dry
   ```

## Rules

- Never run `db:push` from this skill — that bypasses migration files. If the user asks for `db:push`, refuse and point them at `db:generate` + this skill.
- Never apply without the dry-run output visible to the user first.
- If `POSTGRES_URL` points at a production branch, double-confirm before applying.
- If the dry run shows destructive ops (`DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... TYPE`), call them out explicitly in the confirmation prompt.
