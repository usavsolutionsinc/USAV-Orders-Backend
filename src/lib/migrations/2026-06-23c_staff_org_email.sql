-- ============================================================================
-- 2026-06-23c_staff_org_email.sql
--
-- Phase F1 foundation: persist the email captured at signup.
-- Additive + nullable → non-breaking, no deploy coupling (existing code ignores
-- the column; new signup code fills it; old rows stay NULL).
--   staff.email          — the staffer's email (admin owner at signup; later the
--                          key for owner email login + password reset).
--   organizations.billing_email — the org's billing/notification address (fixes
--                          the Stripe checkout "billing+slug@…" fallback caveat).
--
-- Partial unique index on (organization_id, lower(email)) where email is not null
-- — an org can't have two staff with the same email (the future email-login
-- lookup key), without forcing legacy email-less staff to be unique.
-- ============================================================================

ALTER TABLE staff         ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_email text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_org_email
  ON staff (organization_id, lower(email))
  WHERE email IS NOT NULL;
