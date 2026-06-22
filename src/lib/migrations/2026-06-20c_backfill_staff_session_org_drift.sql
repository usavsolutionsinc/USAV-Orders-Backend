-- Backfill + guard: keep staff_sessions.organization_id in sync with staff.
--
-- WHY
-- staff_sessions.organization_id is snapshotted from staff.organization_id at
-- sign-in time (see src/lib/auth/session.ts createSession) and never refreshed
-- for the life of the session. That snapshot is the org segment of every Ably
-- channel name (org:{orgId}:...), so a session whose org drifted from the
-- staffer's current org silently lands on a different channel than freshly
-- signed-in devices. Symptom: the receiving "share to phone" bridge worked for
-- newly-created (test) sessions but not for long-lived prod sessions created
-- before staff were moved off the placeholder org 00000000-…-0001.
--
-- This migration (a) re-points live sessions that have drifted, and (b) installs
-- a trigger so a future staff.organization_id change propagates to live sessions
-- instead of freezing again.

-- ─── (a) One-time backfill of live, drifted sessions ───────────────────────
-- Only non-revoked, unexpired rows, and only where the stored org actually
-- differs from the staffer's current org (keeps the write set — and Neon CU
-- churn — to just the rows that need fixing).
UPDATE staff_sessions s
   SET organization_id = st.organization_id
  FROM staff st
 WHERE s.staff_id = st.id
   AND s.revoked_at IS NULL
   AND s.expires_at > now()
   AND s.organization_id IS DISTINCT FROM st.organization_id;

-- ─── (b) Guard: propagate future staff org changes to live sessions ─────────
-- Fires only when organization_id actually changes. Updates only sessions that
-- were still tracking the OLD staff org — so when the planned org-switcher lands
-- (a session deliberately pinned to a different active org; see the 2026-05-22
-- migration note) this trigger leaves those divergent sessions untouched.
--
-- SECURITY DEFINER + fixed search_path: the trigger must always be able to write
-- staff_sessions for internal consistency, regardless of the (possibly
-- RLS-forced) role that performed the staff UPDATE at runtime.
CREATE OR REPLACE FUNCTION propagate_staff_org_to_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE staff_sessions s
     SET organization_id = NEW.organization_id
   WHERE s.staff_id = NEW.id
     AND s.revoked_at IS NULL
     AND s.organization_id = OLD.organization_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION propagate_staff_org_to_sessions() IS
  'Keeps staff_sessions.organization_id in step with staff.organization_id so the org segment of realtime channel names never freezes on a stale value. Only touches live sessions still tracking the old org (org-switcher-safe).';

DROP TRIGGER IF EXISTS trg_propagate_staff_org_to_sessions ON staff;
CREATE TRIGGER trg_propagate_staff_org_to_sessions
  AFTER UPDATE OF organization_id ON staff
  FOR EACH ROW
  WHEN (NEW.organization_id IS DISTINCT FROM OLD.organization_id)
  EXECUTE FUNCTION propagate_staff_org_to_sessions();
