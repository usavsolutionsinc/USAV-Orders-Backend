-- Phase 1 RLS — enforcement infrastructure (no-op at runtime on its own).
--
-- Background (from the multi-tenancy audit):
--   * The app connects as the table OWNER (neondb_owner). Owners BYPASS RLS
--     unless FORCE ROW LEVEL SECURITY is set — which is why the ENABLE ROW
--     LEVEL SECURITY already present on ~70 tables currently does nothing.
--   * Only a handful of routes run inside withTenantConnection (GUC set);
--     ~343 use the raw pool with no GUC and 17 use Drizzle neon-http which
--     cannot carry a session GUC. Enabling RLS globally would break them.
--
-- Therefore enforcement is OPT-IN PER TABLE. This migration only DEFINES a
-- helper function — it enforces nothing, so it is safe to apply immediately.
-- Per-table enablement lands in follow-up dated migrations, each gated on the
-- routes touching that table having been migrated to the tenant wrappers.
--
-- enforce_tenant_isolation(table) does four things atomically for one table:
--   1. Flips organization_id DEFAULT from the USAV-fallback (the transitional
--      footgun that silently lands stray rows under USAV) to loud-fail, so an
--      INSERT with no app.current_org set now violates NOT NULL instead.
--   2. ENABLE + FORCE row level security (FORCE is required because the app is
--      the table owner).
--   3. (Re)creates the canonical tenant_isolation policy (USING + WITH CHECK).
--   4. Preserves the hermes_agent cross-tenant READ bypass if that role exists.

create or replace function enforce_tenant_isolation(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_relname text;
begin
  -- table must have an organization_id column
  if not exists (
    select 1 from pg_attribute
    where attrelid = p_table and attname = 'organization_id' and not attisdropped
  ) then
    raise exception 'enforce_tenant_isolation: % has no organization_id column', p_table;
  end if;

  select relname into v_relname from pg_class where oid = p_table;

  -- 1. loud-fail default (replaces the COALESCE(..., USAV) transitional default)
  execute format(
    'alter table %s alter column organization_id set default '
    'nullif(current_setting(''app.current_org'', true), '''')::uuid', p_table);

  -- 2. enable + FORCE (owner is subject to RLS only under FORCE)
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);

  -- 3. canonical policy — drop both the new name and the legacy per-table name
  execute format('drop policy if exists tenant_isolation on %s', p_table);
  execute format('drop policy if exists %I on %s', v_relname || '_tenant_isolation', p_table);
  execute format(
    'create policy tenant_isolation on %s '
    'using (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid) '
    'with check (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)',
    p_table);

  -- 4. preserve hermes_agent read-everything bypass
  if exists (select 1 from pg_roles where rolname = 'hermes_agent') then
    execute format('drop policy if exists hermes_agent_read on %s', p_table);
    execute format(
      'create policy hermes_agent_read on %s for select to hermes_agent using (true)', p_table);
  end if;
end;
$$;

-- Reverse helper for rollback during the migration window.
create or replace function relax_tenant_isolation(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format('alter table %s no force row level security', p_table);
  -- restore the transitional USAV-fallback default so raw-pool routes work again
  execute format(
    'alter table %s alter column organization_id set default coalesce('
    'nullif(current_setting(''app.current_org'', true), '''')::uuid, '
    '''00000000-0000-0000-0000-000000000001''::uuid)', p_table);
end;
$$;

-- NO TABLE IS ENFORCED HERE. Per-table rollout happens in follow-up migrations
-- once the touching routes are confirmed to run inside withTenantConnection,
-- e.g. a later file containing:
--   select enforce_tenant_isolation('rag_documents');
--   select enforce_tenant_isolation('rag_document_chunks');
-- See docs/phase-1-rls-plan.md for the gated rollout order.
