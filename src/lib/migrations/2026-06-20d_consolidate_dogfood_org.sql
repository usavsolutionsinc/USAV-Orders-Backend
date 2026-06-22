-- Consolidate stray org data onto the single dogfood org.
--
-- The dogfood deployment runs as one tenant: 00000000-…-0001 (USAV Solutions).
-- Two kinds of rows sat outside it and are folded in here:
--   • genuinely-unowned NULL rows (audit_logs, stripe_events), and
--   • the stray "300c8631 Stripe E2E Test Co" org's rows.
-- The isolation-test orgs (…00aa Test Iso A / …00bb Test Iso B) are LEFT ALONE
-- so the RLS isolation tests keep their fixtures. They hold no business rows
-- today, so nothing of theirs is in scope regardless.
--
-- Scope was verified read-only before writing: the only off-target rows live in
-- the 8 tables touched below, and every one is either NULL or the Stripe test
-- org — none belong to aa/bb. Runs atomically (the migration runner wraps each
-- file in BEGIN/COMMIT); any unique/FK violation rolls the whole thing back.

DO $$
DECLARE
  dogfood     CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  stripe_test CONSTANT uuid := '300c8631-d711-41a5-aecf-0e2ca3204bbc';
BEGIN
  -- 1. Stamp genuinely-unowned (NULL) rows onto the dogfood org.
  UPDATE audit_logs    SET organization_id = dogfood WHERE organization_id IS NULL;
  UPDATE stripe_events SET organization_id = dogfood WHERE organization_id IS NULL;

  -- 2. Fold the Stripe-test-org rows that have NO org-scoped unique key to
  --    violate straight into the dogfood org (the dogfood org has no
  --    billing_subscriptions row, so its org-only PK doesn't collide).
  UPDATE stripe_events         SET organization_id = dogfood WHERE organization_id = stripe_test;
  UPDATE billing_subscriptions SET organization_id = dogfood WHERE organization_id = stripe_test;
  UPDATE staff                 SET organization_id = dogfood WHERE organization_id = stripe_test;
  -- staff_sessions normally follows staff via trg_propagate_staff_org_to_sessions
  -- (2026-06-20c); this catches any revoked/edge row that trigger's WHERE skips.
  UPDATE staff_sessions        SET organization_id = dogfood WHERE organization_id = stripe_test;

  -- 3. The test org's platform/type catalog is a verbatim duplicate of the
  --    dogfood seed — every platform slug and type slug already exists under the
  --    dogfood org — so reassigning would violate uq_platforms_org_slug /
  --    uq_types_org_slug. Drop the duplicate subtree in FK order instead
  --    (types → platform_accounts → platforms). No business row references this
  --    test catalog (the test org has no receiving/order data).
  DELETE FROM types             WHERE organization_id = stripe_test;
  DELETE FROM platform_accounts WHERE organization_id = stripe_test;
  DELETE FROM platforms         WHERE organization_id = stripe_test;
END $$;
