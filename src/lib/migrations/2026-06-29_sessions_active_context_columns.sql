-- ============================================================================
-- 2026-06-29_sessions_active_context_columns.sql
--
-- IDENTITY LAYER — session-collapse GROUNDWORK (additive, non-breaking).
--
-- Adds the swappable active-context pointers to the live session table so a
-- future phase can switch orgs WITHOUT re-authenticating (mint-new-session
-- today). This migration ONLY adds nullable columns — it does NOT change the
-- live auth path. The columns stay unread by server-session.ts until the full
-- cutover (which requires run-the-app auth-flow verification first; see
-- docs/identity-layer-plan.md).
--
--   staff_sessions.active_org_id    org the session is currently acting in
--   staff_sessions.active_staff_id  staff (profile) seat the session points at
--
-- Today the session's org/staff is implied by staff_sessions.staff_id (+ that
-- staff's organization_id). These columns let a single session re-point its
-- active context in place — written ONLY by the (currently unused)
-- switchActiveContext() helper in src/lib/identity/sessions.ts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; nullable, no backfill, org-safe.
-- staff_sessions is not org-scoped (keyed by staff_id); no tenant_isolation
-- DDL applies. FKs match the existing staff_sessions.staff_id reference style.
-- ============================================================================

ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS active_org_id uuid REFERENCES organizations(id);
ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS active_staff_id integer REFERENCES staff(id);

COMMENT ON COLUMN staff_sessions.active_org_id IS 'Session-collapse groundwork: org this session is currently acting in. Unused until the switch-without-re-auth cutover; NULL means "derive from staff_id" (legacy path).';
COMMENT ON COLUMN staff_sessions.active_staff_id IS 'Session-collapse groundwork: staff (profile) seat this session points at. Unused until cutover; NULL means "use staff_id" (legacy path).';
