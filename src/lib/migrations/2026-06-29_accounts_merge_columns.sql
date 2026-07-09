-- ============================================================================
-- 2026-06-29_accounts_merge_columns.sql
--
-- IDENTITY LAYER — account merge support (additive, non-breaking).
--
-- Adds the soft-merge bookkeeping columns used by mergeAccounts()
-- (src/lib/identity/accounts.ts). When an admin folds a duplicate account into
-- a survivor, the merged account is NOT hard-deleted — it is marked
-- status='merged' and records which survivor it was folded into + when, so the
-- audit trail (and any dangling references) stay resolvable.
--
--   accounts.merged_into  the survivor this account was folded into (FK self)
--   accounts.merged_at    when the fold happened
--
-- `accounts.status` is free-text (no enum); the new 'merged' value needs no DDL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; safe to re-run. Identity tables are
-- GLOBAL (no organization_id, no tenant_isolation policy — see
-- 2026-06-20e_identity_layer_phase1.sql), so no org-scoping DDL applies here.
-- ============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES accounts(id);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS merged_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_accounts_merged_into
  ON accounts (merged_into) WHERE merged_into IS NOT NULL;

COMMENT ON COLUMN accounts.merged_into IS 'When folded by mergeAccounts(), the survivor account this duplicate was merged into. NULL for live accounts.';
COMMENT ON COLUMN accounts.merged_at   IS 'Timestamp the account was folded into merged_into.';

-- app_tenant grants: identity tables are un-RLS''d globals; if the non-BYPASSRLS
-- role exists, it already holds privileges on accounts from the phase-1
-- migration''s conditional GRANT block. New columns inherit table-level grants,
-- so nothing further is required here.
