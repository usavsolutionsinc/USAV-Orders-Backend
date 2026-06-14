-- ============================================================================
-- 2026-06-13: receiving_line_views (per-staff "recently viewed" receiving lines)
-- ============================================================================
-- Backs the unbox sidebar's "Viewed" pill. One row per (org, staff, line);
-- viewed_at is upserted to NOW() each time a staff member opens that line in the
-- receiving workspace. Server-backed (not localStorage) so the recents list
-- follows the operator across devices.
--
-- Org-scoped (receiving is now multi-tenant). Reads filter by staff_id (a staff
-- belongs to one org, so this can't leak across tenants); the column + default
-- keep it consistent with the rest of the tenant-owned tables.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS receiving_line_views (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
                      REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id          INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  receiving_line_id INTEGER NOT NULL REFERENCES receiving_lines(id) ON DELETE CASCADE,
  -- Denormalized carton id so the read can resolve the workspace deep-link
  -- without a second join; nullable for lines not yet bound to a carton.
  receiving_id      INTEGER,
  viewed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One recents row per (staff, line); re-opening bumps viewed_at via upsert.
  UNIQUE (organization_id, staff_id, receiving_line_id)
);

COMMENT ON TABLE receiving_line_views IS
  'Per-staff recently-viewed receiving lines (unbox sidebar "Viewed" pill). Upserted on open; ordered by viewed_at DESC on read.';

-- The read: this staff's most-recently-viewed lines, newest first.
CREATE INDEX IF NOT EXISTS idx_receiving_line_views_staff_recent
  ON receiving_line_views (organization_id, staff_id, viewed_at DESC);

-- FK-cascade housekeeping lookups.
CREATE INDEX IF NOT EXISTS idx_receiving_line_views_line
  ON receiving_line_views (receiving_line_id);

COMMIT;
