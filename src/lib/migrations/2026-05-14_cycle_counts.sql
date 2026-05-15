-- ============================================================================
-- 2026-05-14: Cycle count workflow
-- ============================================================================
-- A campaign snapshots `bin_contents.qty` at creation time. The receiver
-- counts each (bin, sku) row physically and submits the counted qty.
--
-- If |counted - expected| / max(expected,1) ≤ variance_tol, the row
-- auto-approves and emits a CYCLE_COUNT_ADJ ledger row. Anything beyond
-- tolerance lands in `pending_review` and waits for an admin's blessing.
--
-- This is the smallest shape that closes the month-end-count gap; we can
-- bolt on assignment, due dates, and warehouse scoping later.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cycle_count_campaigns (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  scope         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 0.05 = 5% — rows within tolerance auto-approve.
  variance_tol  NUMERIC(5,2) NOT NULL DEFAULT 0.05,
  status        TEXT NOT NULL DEFAULT 'open',
  created_by    INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

ALTER TABLE cycle_count_campaigns
  DROP CONSTRAINT IF EXISTS cycle_count_campaigns_status_chk;
ALTER TABLE cycle_count_campaigns
  ADD CONSTRAINT cycle_count_campaigns_status_chk
  CHECK (status IN ('open','closed'));

CREATE INDEX IF NOT EXISTS idx_cycle_count_campaigns_status
  ON cycle_count_campaigns(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cycle_count_lines (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     INT NOT NULL REFERENCES cycle_count_campaigns(id) ON DELETE CASCADE,
  bin_id          INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  expected_qty    INT NOT NULL,
  counted_qty     INT,
  variance        INT GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - expected_qty) STORED,
  status          TEXT NOT NULL DEFAULT 'pending',
  counted_by      INT REFERENCES staff(id) ON DELETE SET NULL,
  counted_at      TIMESTAMPTZ,
  approved_by     INT REFERENCES staff(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cycle_count_lines_unique UNIQUE (campaign_id, bin_id, sku)
);

ALTER TABLE cycle_count_lines
  DROP CONSTRAINT IF EXISTS cycle_count_lines_status_chk;
ALTER TABLE cycle_count_lines
  ADD CONSTRAINT cycle_count_lines_status_chk
  CHECK (status IN ('pending','counted','pending_review','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_campaign_status
  ON cycle_count_lines(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_bin
  ON cycle_count_lines(bin_id) WHERE status IN ('pending','counted','pending_review');

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_sku
  ON cycle_count_lines(sku);

COMMENT ON TABLE cycle_count_campaigns IS 'Physical inventory count campaigns (month-end, location audits, etc.)';
COMMENT ON TABLE cycle_count_lines IS 'Per (bin,sku) expected→counted rows. Auto-approves within variance_tol; otherwise routes to admin review.';

COMMIT;
