-- Canonical mirror of hermes-usav/setup/04_hermes_agent_rls_read.sql.
-- The sibling repo at ~/Desktop/my-express-app/hermes-usav owns the source of
-- truth for the hermes_agent role; this file mirrors the RLS read-policy step
-- so the main repo's migration runner can apply it via the standard flow.
--
-- Grants the read-only `hermes_agent` role visibility to all rows on every
-- RLS-protected table. Without it the agent's tenant-isolation predicate
-- (organization_id = current_setting('app.current_org')) resolves to NULL and
-- the AI chat sees ZERO rows (e.g. "how many orders?" -> 0). SELECT-only and
-- scoped TO hermes_agent, so application roles and write protection are
-- unaffected. See the sibling file for the full rationale.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS hermes_agent_read ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY hermes_agent_read ON public.%I FOR SELECT TO hermes_agent USING (true)',
      r.relname
    );
  END LOOP;
END $$;
