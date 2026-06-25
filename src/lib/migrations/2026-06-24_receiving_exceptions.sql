-- ============================================================================
-- 2026-06-24_receiving_exceptions.sql
--
-- Receiving redesign Phase 0 (plan: iterative-hopping-dragon). Line-level
-- exception / claim domain table. Decomposes the carton-only god-columns
-- (receiving.return_reason / support_notes / zendesk_ticket / exception_code)
-- down to the LINE, so a multi-line carton can attribute "line A damaged, line
-- B fine" — structurally impossible today. Written by the guarded
-- transitionReceivingLine() chokepoint + the manual-advance endpoint (Phase 2/3);
-- read by the Unbox/History panels.
--
-- TENANT-FROM-BIRTH: organization_id NOT NULL with the GUC loud-fail default;
-- per-org keys lead with organization_id.
--
-- ⚠ RLS ARMED, NOT FORCED — the writers (Phase 2/3) are not wired yet, so per
-- the db-migration-author safety gate we do NOT FORCE here; mirrors
-- serial_unit_listings / platform_listings. It joins the FORCE set in a later
-- enforce migration once transitionReceivingLine() stamps org on every write.
-- RLS is inert under neondb_owner (BYPASSRLS) regardless.
--
-- ROLLBACK: DROP TABLE IF EXISTS receiving_exceptions.
-- VERIFY: \d receiving_exceptions; INSERT under a tenant GUC stamps org.
-- ============================================================================

CREATE TABLE IF NOT EXISTS receiving_exceptions (
  id                 bigserial PRIMARY KEY,
  organization_id    uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  receiving_line_id  integer NOT NULL REFERENCES receiving_lines(id) ON DELETE CASCADE,
  receiving_id       integer REFERENCES receiving(id) ON DELETE CASCADE,
  exception_code     text NOT NULL,
  reason             text,
  support_notes      text,
  zendesk_ticket     text,                              -- "#<id>" form, mirrors receiving.zendesk_ticket
  status             text NOT NULL DEFAULT 'OPEN',      -- OPEN | RESOLVED
  created_by         integer,                           -- staff_id (no FK; mirrors inventory_events.actor_staff_id)
  resolved_by        integer,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receiving_exceptions_org_line
  ON receiving_exceptions (organization_id, receiving_line_id);
CREATE INDEX IF NOT EXISTS idx_receiving_exceptions_org_receiving
  ON receiving_exceptions (organization_id, receiving_id)
  WHERE receiving_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receiving_exceptions_org_open
  ON receiving_exceptions (organization_id, status)
  WHERE status = 'OPEN';

-- ── Arm RLS (NOT forced; see header caveat) ─────────────────────────────────
ALTER TABLE receiving_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receiving_exceptions_tenant_isolation ON receiving_exceptions;
CREATE POLICY receiving_exceptions_tenant_isolation ON receiving_exceptions
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

COMMENT ON TABLE receiving_exceptions IS
  'Line-level exception/claim domain (decomposed from the receiving god-table). Receiving redesign Phase 0. RLS armed, not forced (writers land Phase 2/3).';
