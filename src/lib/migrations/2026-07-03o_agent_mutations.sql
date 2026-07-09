-- ============================================================================
-- 2026-07-03o: agent_mutations + agent_mutation_affects — the AI write path
-- (Phase 0 of docs/todo/universal-feed-polymorphic-plan.md §2.6)
-- ============================================================================
-- agent_mutations: one row per AI-proposed (or AI-executed) change — the
-- proposal, its trust-class outcome (auto-applied / draft-applied / awaiting
-- review), full payload, and the learning trail (accepted/rejected stats feed
-- trust-list widening). Linked to the originating chat session.
-- agent_mutation_affects: lean junction — which targets a mutation touched,
-- by canonical ref (plan §-1 Q6 "selective links; jsonb summary on the
-- proposal for context").
--
-- Contract notes (.claude/rules/polymorphic-tables.md):
--   • mutation_kind — validated against the app-layer registry
--     (src/lib/surfaces/registry.ts, the §8 trust-class spec in the plan doc);
--     deliberately NOT a CHECK — the trust list widens as data accumulates,
--     kinds are additive.
--   • status — small stable lifecycle → named CHECK.
--   • agent_mutation_affects.target_ref is a canonical-ref TEXT
--     ('<table>:<axis>:<value>:entity:<id>'), NOT an (entity_type, entity_id)
--     id pair — so the parent-delete trigger family does not apply; the only
--     hard parent is agent_mutations itself (real FK CASCADE). target_kind is
--     registry-validated. Documented gap per contract point 5: a target row
--     deleted later leaves the ref dangling by design — affects rows are an
--     immutable audit/learning trail, not live links.
--   • ai_chat_session_id → ai_chat_sessions(id) is TEXT (that table's PK is a
--     client-minted TEXT id) with ON DELETE SET NULL — mutations must survive
--     chat-session deletion (they are the learning substrate).
--   • updated_at added beyond the plan's sketch (status transitions
--     proposed→applied→reverted need it), per the contract skeleton; likewise
--     agent_mutation_affects gains created_at (no updated_at — immutable trail).
--   • proposed_by_staff_id / applied_by get real FKs → staff(id) ON DELETE
--     SET NULL (plan sketch had bare INTEGERs) — mutations must outlive staff
--     rows, matching the created_by convention elsewhere in this schema.
--
-- Safety gating: brand-new tables, zero writers at author time. The only
-- writer (applyAgentMutation, Phase 3) stamps organization_id explicitly and
-- runs under withTenantTransaction → tenant-from-birth enforcement safe.
--
-- ROLLBACK:
--   select relax_tenant_isolation('agent_mutation_affects');
--   select relax_tenant_isolation('agent_mutations');
--   DROP TABLE IF EXISTS agent_mutation_affects;
--   DROP TABLE IF EXISTS agent_mutations;
--
-- VERIFY (after apply): npm run tenancy:coverage
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS agent_mutations (
  id                   BIGSERIAL PRIMARY KEY,
  organization_id      UUID NOT NULL,              -- no DEFAULT; enforce_tenant_isolation() installs it
  proposed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,   -- the human in the loop; NULL = pure AI
  ai_chat_session_id   TEXT REFERENCES ai_chat_sessions(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'proposed',   -- named CHECK below
  mutation_kind        TEXT NOT NULL,              -- registry-validated (plan §8 spec: kind → trust class + target_kind)
  payload              JSONB,
  review_notes         TEXT,
  applied_by           INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  applied_at           TIMESTAMPTZ,
  extra_audit          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE agent_mutations ADD CONSTRAINT agent_mutations_status_chk
    CHECK (status IN ('proposed','under_review','approved','applied','rejected','reverted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Review queue + AI-edits tray: "this org's mutations by state, newest first".
CREATE INDEX IF NOT EXISTS idx_agent_mutations_org_status_time
  ON agent_mutations (organization_id, status, created_at DESC, id DESC);

-- "Everything this conversation changed" (dock edit trail, learning loop).
CREATE INDEX IF NOT EXISTS idx_agent_mutations_org_session
  ON agent_mutations (organization_id, ai_chat_session_id)
  WHERE ai_chat_session_id IS NOT NULL;

-- Trust-list learning: accept/reject stats per kind.
CREATE INDEX IF NOT EXISTS idx_agent_mutations_org_kind_status
  ON agent_mutations (organization_id, mutation_kind, status);

COMMENT ON TABLE agent_mutations IS
  'AI proposal/apply/learning trail (plan: universal-feed-polymorphic-plan.md §2.6). mutation_kind validated by src/lib/surfaces/registry.ts (§8 trust-class spec). Every apply runs through applyAgentMutation → guarded domain helpers + recordAudit + ops_event + Ably. Tenant-scoped from birth.';

CREATE TABLE IF NOT EXISTS agent_mutation_affects (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL,               -- no DEFAULT; enforce_tenant_isolation() installs it
  agent_mutation_id BIGINT NOT NULL REFERENCES agent_mutations(id) ON DELETE CASCADE,
  target_kind       TEXT NOT NULL,               -- registry-validated ('staff','workflow_node','feed_membership',...)
  target_ref        TEXT NOT NULL,               -- canonical ref: '<table>:<axis>:<value>:entity:<id>' or composite key
  role_in_mutation  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_mutation_affects_org_mutation
  ON agent_mutation_affects (organization_id, agent_mutation_id);

-- "What has the AI touched about this target" (history + trust audits).
CREATE INDEX IF NOT EXISTS idx_agent_mutation_affects_org_target
  ON agent_mutation_affects (organization_id, target_kind, target_ref);

COMMENT ON TABLE agent_mutation_affects IS
  'Lean mutation→target junction by canonical ref (plan §2.6). Immutable audit/learning trail — refs may dangle after target deletion by design. target_kind validated by src/lib/surfaces/registry.ts. Tenant-scoped from birth.';

-- ── Tenant-from-birth enforcement (both tables) ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('agent_mutations');
    PERFORM enforce_tenant_isolation('agent_mutation_affects');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — agent_mutations/agent_mutation_affects left without FORCE RLS';
  END IF;
END $$;

COMMIT;
