# Polymorphic / typed-fact table contract

Ratified 2026-07-01 (Phase 0 of `docs/todo/schema-wide-polymorphic-refactor-plan.md`) from the two cleanest
live examples this schema already had: `part_links` (`2026-06-28g_part_links.sql`, tenant-from-birth) and
`photo_entity_links` (`2026-06-18_photos_platform_side_tables.sql`, normalized polymorphic hub). Every **new**
polymorphic-reference or typed-fact table must match this shape. **Existing surfaces are not retroactively
renamed or migrated by this doc** — see the gap list at the bottom for what's still inconsistent and why it's
left alone for now.

Detail on the origin scan (10 cross-surface inconsistencies, Tier-1/2/3 monolith findings, jsonb taxonomy,
discriminator inventory) lives in `docs/todo/schema-wide-polymorphic-refactor-plan.md` Appendices A–D. This
file is the actionable contract distilled from that scan, not a restatement of it.

## The contract

A polymorphic-reference or typed-fact table is any table that (a) points at one of several possible parent
tables via a discriminator + id pair, or (b) is a governed variant/event-payload store keyed by a discriminator
column. New tables of either shape must have:

1. **Discriminator column**: a **named CHECK** constraint enumerating the allowed values (`ALTER TABLE <t> ADD
   CONSTRAINT <t>_<col>_chk CHECK (<col> IN (...))`, wrapped in the idempotent `DO $$ ... EXCEPTION WHEN
   duplicate_object THEN NULL; END $$;` guard). Reserve a native pg **ENUM** only for a small, stable, rarely-
   extended set (`work_entity_type_enum` is the one existing example) — `ALTER TYPE ... ADD VALUE` is awkward
   and a CHECK redefinition is easy to get wrong (see the `reason_codes_flow_context_chk` regression this scan
   turned up — five migrations touching one CHECK, several of them dropping values the previous one added,
   only saved because the last-sorting filename happened to re-affirm the full union). **Never** ship a
   discriminator as unconstrained free text.
2. **Id column: BIGINT/BIGSERIAL by default.** Match the parent's actual PK type only when the parent's PK is
   genuinely UUID (e.g. `entity_notes.entity_id` is UUID because its only parent, `sales_orders`, has a UUID
   PK) — don't invent a UUID id column for INTEGER-keyed parents or vice versa. `photo_entity_links.entity_id`
   (BIGINT) is the reference for the common case; going forward, prefer BIGINT even when today's actual parent
   happens to be INTEGER-keyed, so the column doesn't need widening if a future parent isn't.
3. **Naming: `entity_type`/`entity_id`.** Not `owner_type`/`owner_id` (that's `shipment_links`' legacy name,
   kept as-is — don't rename it, don't reuse the `owner_*` convention for anything new). Add a second
   discriminator axis (like `photo_entity_links.link_role`) only when the table genuinely has more than one
   relationship kind per (entity_type, entity_id) pair.
4. **Org-led indexes.** Every unique or partial-unique index leads with `organization_id` —
   `(organization_id, entity_type, entity_id, ...)`, never a global unique on the polymorphic key alone.
5. **Parent-delete integrity — pick one, don't ship neither:**
   - A **real FK** `ON DELETE CASCADE`/`SET NULL` when the table has one non-polymorphic parent
     (`receiving_exceptions`, `part_links.parent_item_id`).
   - A **BEFORE/AFTER DELETE trigger family**, one `CREATE TRIGGER trg_<action>_<child>_on_<parent>_delete`
     per parent the discriminator can name, sharing one generic trigger function that dispatches on
     `TG_ARGV[0]` (see `fn_delete_photos_on_parent_delete()` / `fn_cancel_work_assignments_on_entity_delete()`
     for the two established shapes — cascade-delete vs. cancel-in-place). **When a table adds a new
     discriminator value, add its trigger in the same migration** — `work_assignments` shipped 5
     `work_entity_type_enum` values but only ever wired up 2 triggers (`ORDER`, `RECEIVING`); the other 3
     (`REPAIR`, `FBA_SHIPMENT`, `SKU_STOCK`) silently had no delete-time behavior for months until
     `2026-07-01j_polymorphic_orphan_delete_triggers.sql` closed the gap. Don't repeat that.
   - If a value genuinely can't be given real integrity yet (no confirmed writer, no confirmed parent table —
     e.g. `documents.entity_type = 'WALK_IN_ORDER'`, see that migration's header), **document the gap in the
     migration comment and skip it explicitly** — don't guess at a parent table name in DDL.
6. **Entity-existence validation is delegated to the application layer, not a DB trigger.** `photos` used to
   validate `entity_id` against the named parent table in a trigger (`fn_validate_photo_entity_ref`), and that
   validation was **deliberately removed** in Phase E (`2026-06-21_photos_phase_e_drop_legacy_columns.sql`) in
   favor of the writing lib function (`photo_entity_links` inserts) being the enforcement point. This is the
   house answer, not an open question: new polymorphic writes validate the parent exists in the domain helper
   that performs the insert (mirrors the `Deps`-injected domain-function pattern in `backend-patterns.md`), not
   in a `CREATE CONSTRAINT TRIGGER`. Existing tables are not being retrofitted with existence triggers.
7. **Tenant-from-birth.** `organization_id UUID NOT NULL` with **no DEFAULT in the raw DDL** — call
   `enforce_tenant_isolation('<table>')` (guarded by `IF EXISTS (SELECT 1 FROM pg_proc WHERE proname =
   'enforce_tenant_isolation')`) in the **same migration** that creates the table. That call installs the
   loud-fail GUC default, FORCE RLS, and the canonical `tenant_isolation` policy — don't hand-write any of the
   three. FORCE-from-birth, not a later backstop wave.
8. **Model it in Drizzle in the same PR.** `photo_entity_links`, `part_links`, and `organization_integrations`
   went unmodeled in `src/lib/drizzle/schema.ts` for weeks after their birth migrations landed, meaning
   type-level code was blind to real live tables. A hand-written SQL migration is still the schema source of
   truth (this repo doesn't run `drizzle-kit push` against production), but the Drizzle model must be added
   alongside it so readers get real types. Model CHECK-constrained discriminator values in a comment (Drizzle
   doesn't have a first-class "text column with an enumerated CHECK" type) — don't leave the column bare.

## Canonical DDL skeleton

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS <table> (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,                 -- NO default; enforce_tenant_isolation() installs it
  entity_type     TEXT NOT NULL,                 -- discriminator; named CHECK below
  entity_id       BIGINT NOT NULL,
  -- ... typed fact columns (promote queryable business facts to real columns;
  --     keep only true variant config in jsonb — see Appendix C's taxonomy) ...
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE <table> ADD CONSTRAINT <table>_entity_type_chk
    CHECK (entity_type IN ('RECEIVING','ORDER',/* ... */));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_<table>_natural
  ON <table> (organization_id, entity_type, entity_id /*, second axis if any */);
CREATE INDEX IF NOT EXISTS idx_<table>_entity
  ON <table> (organization_id, entity_type, entity_id);

-- Parent-delete integrity: EITHER a real FK ON DELETE CASCADE on the
-- non-polymorphic side, OR one CREATE TRIGGER per nameable parent sharing a
-- generic dispatch-on-TG_ARGV[0] function. Never ship neither.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('<table>');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — <table> left without FORCE RLS';
  END IF;
END $$;

COMMIT;
```

Then add the matching `pgTable(...)` to `src/lib/drizzle/schema.ts` in the same change.

## What this doc does NOT do

- **Does not rename or migrate existing surfaces.** `shipment_links` keeps `owner_type`/`owner_id`;
  `documents`/`entity_notes` keep their free-text, untriggered-on-some-parents shape beyond what
  `2026-07-01j_polymorphic_orphan_delete_triggers.sql` closed; `work_assignments` keeps its INTEGER id and pg
  ENUM discriminator. Renaming/migrating those is a Phase-4-style cleanup wave, not a Phase-0 change.
- **Does not add DB-side entity-existence validation anywhere.** See point 6 — that's a resolved decision
  (app-side only), not a TODO.
- **Does not pick a schema-validation mechanism for `jsonb` variant-config columns** (`workflow_nodes.config`
  and friends) — that's a separate, still-open question in the parent plan doc's "Workflow / Studio Config"
  section, not part of the polymorphic-reference contract above.

Related: `.claude/rules/backend-patterns.md` (state machine, audit, tenant scoping, `Deps` injection — the
non-schema half of the same conventions), `.claude/rules/source-of-truth.md` (single-source mapping rule this
contract's "model it in Drizzle" point extends into schema land).
