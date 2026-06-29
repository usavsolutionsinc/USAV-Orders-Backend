-- ============================================================================
-- 2026-06-27e_order_unit_amendments.sql
--
-- Fulfillment substitution / order-line amendment record. When the unit that
-- physically ships deviates from what was ordered/listed (the classic
-- "customer asked for white even though the order is for black", or a tester
-- regrades the unit, or the picked serial is swapped), the deviation is an
-- AUDITED RE-ALLOCATION EVENT — not a silent edit. This table is the durable
-- "ordered vs fulfilled" record that hangs off that event.
--
-- The substitution itself (release original allocation → allocate the
-- substitute unit) flows through the existing state machine + order_unit_allocations
-- so /api/pack/ship's allocation check passes naturally for the substitute serial.
-- This row captures WHY + the original-vs-fulfilled delta for audit, dispute
-- defense, customer notification, and optional channel write-back.
--
-- Per-org configurable (settings-registry + /studio): WHICH node may raise an
-- amendment, advisory-vs-block_until_approved enforcement, and how far the
-- deviation propagates (internal / notify-customer / channel-sync). Those knobs
-- live in the settings layer; this table just records the event + its approval
-- state.
--
-- Tenant-from-birth: organization_id NOT NULL (GUC default) + enforce_tenant_isolation()
-- applied at the end — every reader/writer is GUC-scoped (withTenantTransaction)
-- from day one, so FORCE RLS is safe immediately (no app-layer-only window).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS order_unit_amendments (
  id                       BIGSERIAL PRIMARY KEY,
  organization_id          UUID NOT NULL
                             DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,

  -- The order whose line was amended.
  order_id                 INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- ── Original (what was ordered / listed / originally allocated) ────────────
  -- The released allocation + the unit that was on it. Allocation id is nullable
  -- because a substitution may be raised after the original was already released
  -- (e.g. short-picked first, swapped later).
  original_allocation_id   INTEGER,
  original_unit_id         INTEGER REFERENCES serial_units(id) ON DELETE SET NULL,
  original_sku             TEXT,
  original_condition       TEXT,

  -- ── Fulfilled (what physically ships now) ──────────────────────────────────
  -- The new allocation + the substitute unit now bound to the order.
  substitute_allocation_id INTEGER,
  substitute_unit_id       INTEGER REFERENCES serial_units(id) ON DELETE SET NULL,
  fulfilled_sku            TEXT,
  fulfilled_condition      TEXT,

  -- ── Why + provenance ───────────────────────────────────────────────────────
  -- reason_code is required (the amendment must justify itself). Free-text
  -- customer_request_note captures "customer asked for white"; photo_id points
  -- at evidence of the actual unit (photos link polymorphically by
  -- entity_type/entity_id elsewhere, so this is a soft reference, not an FK).
  reason_code              TEXT NOT NULL,
  customer_request_note    TEXT,
  photo_id                 INTEGER,
  -- Per-substitution idempotency key (house pattern): a retry of the same
  -- substitution returns the existing amendment instead of erroring on the
  -- now-RELEASED original allocation. NULL for callers that don't thread one.
  client_event_id          UUID,
  -- Which fulfillment station raised the amendment. Per-org config decides which
  -- of these is allowed (default: pick); the value is recorded regardless.
  raised_at_node           TEXT NOT NULL DEFAULT 'pick',

  -- ── Approval / enforcement ─────────────────────────────────────────────────
  -- APPLIED  → advisory mode: re-allocation already committed, no gate.
  -- PENDING  → block_until_approved mode: re-allocation committed but the order
  --            cannot pack/ship until a supervisor APPROVES (the gate is read by
  --            pack/ship, not enforced by this row).
  -- APPROVED → a PENDING amendment cleared by a supervisor.
  -- REJECTED → a PENDING amendment denied (caller must rewind the re-allocation).
  status                   TEXT NOT NULL DEFAULT 'APPLIED',
  raised_by                INTEGER,
  approved_by              INTEGER,
  approved_at              TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE order_unit_amendments
    ADD CONSTRAINT order_unit_amendments_status_chk
    CHECK (status IN ('APPLIED', 'PENDING', 'APPROVED', 'REJECTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE order_unit_amendments
    ADD CONSTRAINT order_unit_amendments_node_chk
    CHECK (raised_at_node IN ('pick', 'test', 'pack', 'ship', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Hot path: load an order's amendments (timeline + pack/ship gate read).
CREATE INDEX IF NOT EXISTS idx_order_unit_amendments_order
  ON order_unit_amendments (organization_id, order_id);

-- Pending-approval queue (only populated under block_until_approved orgs).
CREATE INDEX IF NOT EXISTS idx_order_unit_amendments_pending
  ON order_unit_amendments (organization_id, status)
  WHERE status = 'PENDING';

-- Idempotency: a threaded client_event_id collapses a retry to a no-op. Partial
-- unique (NULLs excluded) so callers without a key are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_unit_amendments_client_event
  ON order_unit_amendments (organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

COMMIT;

-- Tenant-from-birth enforcement: ENABLE + FORCE RLS + tenant_isolation policy +
-- swap the column default to the loud-fail enforce_tenant_isolation() expression,
-- idempotently. Safe immediately — all access is GUC-scoped from day one.
SELECT enforce_tenant_isolation('order_unit_amendments');
