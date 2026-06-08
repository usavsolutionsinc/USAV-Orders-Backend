-- ============================================================================
-- 2026-06-07: Warranty Claim Logger — enum columns → text (+ CHECK)
-- ============================================================================
-- The 2026-06-06 migration defined status / clock_basis / outcome as Postgres
-- ENUM types, but the Drizzle schema (text('...')) and every raw pool.query in
-- src/lib/warranty/* treat them as text. A bound text param against an enum
-- column ("status = $1") errors: `operator does not exist: ..._enum = text`.
--
-- House convention (see reason_codes) is text columns + a CHECK constraint, so
-- we convert here and drop the now-unused enum types. Empty tables → no data
-- risk. After this, every warranty query "just works" with text params.
-- ============================================================================

BEGIN;

-- ─── 1. Drop indexes that reference the enum columns (recreated below) ───────
DROP INDEX IF EXISTS idx_warranty_claims_status;
DROP INDEX IF EXISTS idx_warranty_claims_expiry;
DROP INDEX IF EXISTS idx_warranty_claims_provisional;
DROP INDEX IF EXISTS idx_warranty_claims_recompute;
DROP INDEX IF EXISTS idx_warranty_quotes_status;

-- ─── 2. warranty_claims ──────────────────────────────────────────────────────
ALTER TABLE warranty_claims ALTER COLUMN status DROP DEFAULT;
ALTER TABLE warranty_claims ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE warranty_claims ALTER COLUMN status SET DEFAULT 'LOGGED';
ALTER TABLE warranty_claims ALTER COLUMN clock_basis TYPE text USING clock_basis::text;

ALTER TABLE warranty_claims ADD CONSTRAINT warranty_claims_status_chk
  CHECK (status IN ('LOGGED','SUBMITTED','APPROVED','DENIED','IN_REPAIR','REPAIRED','CLOSED','EXPIRED'));
ALTER TABLE warranty_claims ADD CONSTRAINT warranty_claims_clock_basis_chk
  CHECK (clock_basis IS NULL OR clock_basis IN ('DELIVERED','PACKED_PLUS_ESTIMATE'));

-- ─── 3. warranty_claim_events ────────────────────────────────────────────────
ALTER TABLE warranty_claim_events ALTER COLUMN from_status TYPE text USING from_status::text;
ALTER TABLE warranty_claim_events ALTER COLUMN to_status TYPE text USING to_status::text;

-- ─── 4. warranty_repair_attempts ─────────────────────────────────────────────
ALTER TABLE warranty_repair_attempts ALTER COLUMN outcome TYPE text USING outcome::text;
ALTER TABLE warranty_repair_attempts ADD CONSTRAINT warranty_repair_outcome_chk
  CHECK (outcome IS NULL OR outcome IN ('FIXED','NOT_FIXABLE','PENDING_PARTS','RTV'));

-- ─── 5. warranty_quotes ──────────────────────────────────────────────────────
ALTER TABLE warranty_quotes ALTER COLUMN status DROP DEFAULT;
ALTER TABLE warranty_quotes ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE warranty_quotes ALTER COLUMN status SET DEFAULT 'DRAFT';
ALTER TABLE warranty_quotes ADD CONSTRAINT warranty_quotes_status_chk
  CHECK (status IN ('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED'));

-- ─── 6. Recreate indexes with plain text predicates (no enum casts) ──────────
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims (status);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_expiry ON warranty_claims (warranty_expires_at)
  WHERE status NOT IN ('CLOSED', 'EXPIRED');
CREATE INDEX IF NOT EXISTS idx_warranty_claims_provisional ON warranty_claims (clock_basis)
  WHERE clock_basis = 'PACKED_PLUS_ESTIMATE' AND status NOT IN ('CLOSED', 'EXPIRED');
CREATE INDEX IF NOT EXISTS idx_warranty_claims_recompute ON warranty_claims (updated_at)
  WHERE clock_basis IS DISTINCT FROM 'DELIVERED'
    AND status NOT IN ('CLOSED', 'EXPIRED')
    AND order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_quotes_status ON warranty_quotes (status);

-- ─── 7. Drop the now-unused enum types ───────────────────────────────────────
DROP TYPE IF EXISTS warranty_claim_status_enum;
DROP TYPE IF EXISTS warranty_clock_basis_enum;
DROP TYPE IF EXISTS warranty_repair_outcome_enum;
DROP TYPE IF EXISTS warranty_quote_status_enum;

COMMIT;
