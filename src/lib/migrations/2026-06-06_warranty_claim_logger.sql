-- ============================================================================
-- 2026-06-06: Warranty Claim Logger + Repair Outcome Tracker (Phase 1)
-- ============================================================================
-- Adds the warranty-claim domain as a first-class entity, surfaced as the 4th
-- mode on the Orders / Shipping page (Awaiting · Pending · Shipped · Warranty
-- Logger). A claim logs a serial + purchase proof + the warranty clock, tracks
-- status (incl. denial reasons), records repair attempts/outcomes with photo +
-- parts attachments, and can spin up a post-warranty paid-repair quote.
--
-- Warranty clock (computed in src/lib/warranty/clock.ts, stamped here):
--   warranty_expires_at = (carrier DELIVERED date, else packed/scanned + 4d) + term
--   clock_basis = DELIVERED | PACKED_PLUS_ESTIMATE
-- PACKED_PLUS_ESTIMATE is provisional and recomputed when a real DELIVERED date
-- lands (the existing adaptive tracking cron — see tracking-live-sync).
--
-- Reuse, not duplication:
--   - Physical returns link out to rma_authorizations (2026-05-23) via rma_id.
--   - Repair handoff links to repair_service via repair_service_id.
--   - Denial reasons reuse reason_codes (new 'warranty_denial' category below).
--   - Photos use the NAS direct-write path; we only store attachment refs.
--
-- organization_id mirrors the orgIdCol() helper in schema.ts (defaults from the
-- app.current_org session GUC so tenant-scoped writes populate it).
--
-- Everything ships dark behind the WARRANTY_LOGGER flag; this migration adds no
-- behavior on its own. Routes: src/app/api/warranty/*. Module: src/lib/warranty/*.
-- ============================================================================

BEGIN;

-- ─── 1. Enums ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE warranty_claim_status_enum AS ENUM (
    'LOGGED',
    'SUBMITTED',
    'APPROVED',
    'DENIED',
    'IN_REPAIR',
    'REPAIRED',
    'CLOSED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE warranty_clock_basis_enum AS ENUM (
    'DELIVERED',
    'PACKED_PLUS_ESTIMATE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE warranty_repair_outcome_enum AS ENUM (
    'FIXED',
    'NOT_FIXABLE',
    'PENDING_PARTS',
    'RTV'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE warranty_quote_status_enum AS ENUM (
    'DRAFT',
    'SENT',
    'ACCEPTED',
    'DECLINED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Extend reason_codes with the warranty_denial category ────────────────
-- Denial reasons are config-managed exactly like reason codes, so we widen the
-- category CHECK instead of standing up a parallel lookup table.
ALTER TABLE reason_codes DROP CONSTRAINT IF EXISTS reason_codes_category_chk;
ALTER TABLE reason_codes
  ADD CONSTRAINT reason_codes_category_chk
  CHECK (category IN (
    'shrinkage','adjustment','sale','return','movement','initial','warranty_denial'
  ));

INSERT INTO reason_codes (code, label, category, direction, requires_note, requires_photo, sort_order) VALUES
  ('WD_OUT_OF_WINDOW',   'Outside warranty window',        'warranty_denial', 'out', true,  false, 71),
  ('WD_NO_PROOF',        'No valid purchase proof',        'warranty_denial', 'out', true,  false, 72),
  ('WD_PHYSICAL_DAMAGE', 'Physical / accidental damage',   'warranty_denial', 'out', true,  true,  73),
  ('WD_MISUSE',          'Misuse / unauthorized repair',   'warranty_denial', 'out', true,  false, 74),
  ('WD_NO_FAULT_FOUND',  'No fault found',                 'warranty_denial', 'out', true,  false, 75),
  ('WD_NOT_COVERED',     'Component not covered',          'warranty_denial', 'out', true,  false, 76)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  direction = EXCLUDED.direction,
  requires_note = EXCLUDED.requires_note,
  requires_photo = EXCLUDED.requires_photo,
  sort_order = EXCLUDED.sort_order;

-- ─── 3. warranty_claims ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warranty_claims (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       UUID NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  claim_number          TEXT NOT NULL UNIQUE,             -- WC-YYYY-NNNNN

  -- Subject of the claim (serial + denormalized snapshot, like repair_service)
  serial_unit_id        INTEGER REFERENCES serial_units(id) ON DELETE SET NULL,
  serial_number         TEXT,
  order_id              INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  sku                   TEXT,
  product_title         TEXT,
  customer_id           INTEGER REFERENCES customers(id) ON DELETE SET NULL,

  -- Source provenance
  source_system         TEXT,                             -- ebay | zoho | manual | …
  source_order_id       TEXT,
  source_tracking_number TEXT,

  -- Purchase proof
  purchase_proof_url            TEXT,
  purchase_proof_attachment_id  TEXT,                     -- NAS ref
  purchased_at          TIMESTAMPTZ,

  -- Warranty clock (computed in src/lib/warranty/clock.ts)
  delivered_at          TIMESTAMPTZ,
  packed_scanned_at     TIMESTAMPTZ,
  warranty_starts_at    TIMESTAMPTZ,
  warranty_expires_at   TIMESTAMPTZ,
  clock_basis           warranty_clock_basis_enum,
  warranty_days         INTEGER,                          -- term snapshot at log time

  -- Lifecycle
  status                warranty_claim_status_enum NOT NULL DEFAULT 'LOGGED',
  denial_reason_code    TEXT REFERENCES reason_codes(code) ON DELETE SET NULL,
  denial_notes          TEXT,

  -- Cross-links (reuse, not duplicate)
  rma_id                BIGINT REFERENCES rma_authorizations(id) ON DELETE SET NULL,
  repair_service_id     INTEGER REFERENCES repair_service(id) ON DELETE SET NULL,

  notes                 TEXT,
  created_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE warranty_claims IS
  'First-class warranty claim. The customer-facing record (status, denial, clock); physical returns link out to rma_authorizations and repair handoff to repair_service.';

CREATE INDEX IF NOT EXISTS idx_warranty_claims_org ON warranty_claims (organization_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims (status);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_serial_unit ON warranty_claims (serial_unit_id)
  WHERE serial_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_claims_customer ON warranty_claims (customer_id)
  WHERE customer_id IS NOT NULL;
-- "what is expiring soon / still provisional" — the countdown + recompute sweep.
CREATE INDEX IF NOT EXISTS idx_warranty_claims_expiry ON warranty_claims (warranty_expires_at)
  WHERE status NOT IN ('CLOSED', 'EXPIRED');
CREATE INDEX IF NOT EXISTS idx_warranty_claims_provisional ON warranty_claims (clock_basis)
  WHERE clock_basis = 'PACKED_PLUS_ESTIMATE' AND status NOT IN ('CLOSED', 'EXPIRED');
-- Covers the Phase 3 recompute sweep: filter (not-delivered, open, has order) +
-- ORDER BY updated_at, so the cron scans the partial index and LIMITs without a sort.
CREATE INDEX IF NOT EXISTS idx_warranty_claims_recompute ON warranty_claims (updated_at)
  WHERE clock_basis IS DISTINCT FROM 'DELIVERED'::warranty_clock_basis_enum
    AND status NOT IN ('CLOSED', 'EXPIRED')
    AND order_id IS NOT NULL;

-- ─── 4. warranty_claim_events ────────────────────────────────────────────────
-- Append-only timeline (status changes, notes, attachments, notifications).
CREATE TABLE IF NOT EXISTS warranty_claim_events (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       UUID NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  claim_id              BIGINT NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL,                    -- STATUS_CHANGE | NOTE | NOTIFICATION_SENT | ATTACHMENT_ADDED | REPAIR_LOGGED
  from_status           warranty_claim_status_enum,
  to_status             warranty_claim_status_enum,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_staff_id        INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE warranty_claim_events IS
  'Append-only per-claim audit/status timeline. Queryable rows (not a jsonb blob) so per-tenant history and notification logs are first-class.';

CREATE INDEX IF NOT EXISTS idx_warranty_events_claim ON warranty_claim_events (claim_id, created_at DESC);

-- ─── 5. warranty_repair_attempts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warranty_repair_attempts (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       UUID NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  claim_id              BIGINT NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  attempt_no            INTEGER NOT NULL DEFAULT 1,
  technician_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  diagnosis             TEXT,
  parts_used            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{sku, qty, cost}]
  outcome               warranty_repair_outcome_enum,
  labor_minutes         INTEGER,
  cost_parts            NUMERIC(12,2),
  cost_labor            NUMERIC(12,2),
  photo_attachment_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- NAS photo refs
  notes                 TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE warranty_repair_attempts IS
  'One row per repair attempt/outcome on a warranty claim, with parts-used + photo attachments. Richer than work_assignments.repair_outcome (single text).';

CREATE INDEX IF NOT EXISTS idx_warranty_repair_claim ON warranty_repair_attempts (claim_id, attempt_no);

-- ─── 6. warranty_quotes (post-warranty paid repair) ──────────────────────────
CREATE TABLE IF NOT EXISTS warranty_quotes (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       UUID NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  claim_id              BIGINT NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  quote_number          TEXT NOT NULL UNIQUE,             -- WQ-YYYY-NNNNN
  line_items            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{label, qty, unitPrice}]
  subtotal              NUMERIC(12,2),
  tax                   NUMERIC(12,2),
  total                 NUMERIC(12,2),
  status                warranty_quote_status_enum NOT NULL DEFAULT 'DRAFT',
  sent_at               TIMESTAMPTZ,
  responded_at          TIMESTAMPTZ,
  valid_until           TIMESTAMPTZ,
  created_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE warranty_quotes IS
  'Post-warranty paid-repair quote for a denied/expired claim. On ACCEPTED, hands off to repair_service.';

CREATE INDEX IF NOT EXISTS idx_warranty_quotes_claim ON warranty_quotes (claim_id);
CREATE INDEX IF NOT EXISTS idx_warranty_quotes_status ON warranty_quotes (status);

COMMIT;
