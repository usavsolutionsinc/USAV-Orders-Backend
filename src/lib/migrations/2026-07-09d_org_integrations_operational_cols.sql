-- 2026-07-09d — organization_integrations operational columns (oauth-plan Phase 1 residuals).
--
-- Adds the connection-operations facts the connector layer reads/writes:
--   last_synced_at   — when the orchestrator last ran this connection's sync()
--   last_sync_status — outcome of that run (named CHECK: ok / error / never)
--   sync_cursor      — opaque incremental watermark for the next sync run
--   enabled          — per-connection kill switch (default true)
--   expires_at       — access-token expiry; drives the token refresh sweep
--                      (src/lib/integrations/connectors/refresh-sweep.ts)
--
-- NO org-column changes: the table is already tenant-scoped (organization_id
-- NOT NULL + tenant_isolation RLS from its birth migration). Idempotent.
-- Drizzle model updated in the same change (src/lib/drizzle/schema.ts).

BEGIN;

ALTER TABLE organization_integrations ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE organization_integrations ADD COLUMN IF NOT EXISTS last_sync_status TEXT DEFAULT 'never';
ALTER TABLE organization_integrations ADD COLUMN IF NOT EXISTS sync_cursor TEXT;
ALTER TABLE organization_integrations ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;
ALTER TABLE organization_integrations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Named CHECK on the sync-status discriminator (NULL passes — pre-existing rows).
DO $$ BEGIN
  ALTER TABLE organization_integrations
    ADD CONSTRAINT organization_integrations_last_sync_status_chk
    CHECK (last_sync_status IN ('ok', 'error', 'never'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Refresh-sweep scan path: active + enabled connections with a known expiry.
CREATE INDEX IF NOT EXISTS idx_org_integrations_expires_at
  ON organization_integrations (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

COMMIT;
