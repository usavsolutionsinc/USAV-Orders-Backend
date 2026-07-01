-- Platform-agnostic support ticket registry + ticket_links.support_ticket_id.
--
-- Operators see support_tickets.id as the ticket number (#42). Provider-native
-- ids (Zendesk today; Freshdesk/internal later) live in external_ticket_id.
-- ticket_links remains the polymorphic entity hub; zendesk_ticket_id is kept for
-- provider API calls during the transition.
--
-- Safety: idempotent DDL; backfill is INSERT…ON CONFLICT / NOT EXISTS only.
-- Writers stamp organization_id via tenantQuery / withTenantTransaction.
-- ROLLBACK: drop support_ticket_id column + support_tickets (after cutting readers).

BEGIN;

CREATE TABLE IF NOT EXISTS support_tickets (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     UUID NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'zendesk'
    CHECK (provider IN ('zendesk', 'internal')),
  external_ticket_id  TEXT,
  subject_cache       TEXT,
  status_cache        TEXT,
  created_by          INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_support_tickets_provider_external
  ON support_tickets (organization_id, provider, external_ticket_id)
  WHERE external_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_org
  ON support_tickets (organization_id, id DESC);

ALTER TABLE ticket_links
  ADD COLUMN IF NOT EXISTS support_ticket_id BIGINT REFERENCES support_tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ticket_links_support_ticket
  ON ticket_links (support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;

-- ── Backfill 1: existing ticket_links → support_tickets ───────────────────
INSERT INTO support_tickets (organization_id, provider, external_ticket_id, created_by)
SELECT DISTINCT tl.organization_id, 'zendesk', tl.zendesk_ticket_id::text, tl.created_by
  FROM ticket_links tl
 WHERE tl.zendesk_ticket_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE ticket_links tl
   SET support_ticket_id = st.id
  FROM support_tickets st
 WHERE tl.support_ticket_id IS NULL
   AND st.organization_id = tl.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = tl.zendesk_ticket_id::text;

-- ── Backfill 2: receiving.zendesk_ticket → ticket + link ──────────────────
INSERT INTO support_tickets (organization_id, provider, external_ticket_id)
SELECT DISTINCT r.organization_id, 'zendesk', regexp_replace(trim(r.zendesk_ticket), '^#', '')
  FROM receiving r
 WHERE r.zendesk_ticket IS NOT NULL
   AND trim(r.zendesk_ticket) ~ '^#?[0-9]{1,12}$'
ON CONFLICT DO NOTHING;

INSERT INTO ticket_links (organization_id, support_ticket_id, zendesk_ticket_id, entity_type, entity_id)
SELECT r.organization_id,
       st.id,
       st.external_ticket_id::bigint,
       'RECEIVING',
       r.id
  FROM receiving r
  JOIN support_tickets st
    ON st.organization_id = r.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = regexp_replace(trim(r.zendesk_ticket), '^#', '')
 WHERE r.zendesk_ticket IS NOT NULL
   AND trim(r.zendesk_ticket) ~ '^#?[0-9]{1,12}$'
   AND NOT EXISTS (
         SELECT 1 FROM ticket_links tl
          WHERE tl.organization_id = r.organization_id
            AND tl.entity_type = 'RECEIVING'
            AND tl.entity_id = r.id
            AND (
              tl.support_ticket_id = st.id
              OR tl.zendesk_ticket_id = st.external_ticket_id::bigint
            )
       )
ON CONFLICT (organization_id, zendesk_ticket_id) DO UPDATE
  SET support_ticket_id = EXCLUDED.support_ticket_id,
      entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      updated_at = NOW();

-- ── Backfill 3: receiving_lines.zendesk_ticket ─────────────────────────────
INSERT INTO support_tickets (organization_id, provider, external_ticket_id)
SELECT DISTINCT rl.organization_id, 'zendesk', regexp_replace(trim(rl.zendesk_ticket), '^#', '')
  FROM receiving_lines rl
 WHERE rl.zendesk_ticket IS NOT NULL
   AND trim(rl.zendesk_ticket) ~ '^#?[0-9]{1,12}$'
ON CONFLICT DO NOTHING;

INSERT INTO ticket_links (organization_id, support_ticket_id, zendesk_ticket_id, entity_type, entity_id)
SELECT rl.organization_id,
       st.id,
       st.external_ticket_id::bigint,
       'RECEIVING_LINE',
       rl.id
  FROM receiving_lines rl
  JOIN support_tickets st
    ON st.organization_id = rl.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = regexp_replace(trim(rl.zendesk_ticket), '^#', '')
 WHERE rl.zendesk_ticket IS NOT NULL
   AND trim(rl.zendesk_ticket) ~ '^#?[0-9]{1,12}$'
   AND NOT EXISTS (
         SELECT 1 FROM ticket_links tl
          WHERE tl.organization_id = rl.organization_id
            AND tl.entity_type = 'RECEIVING_LINE'
            AND tl.entity_id = rl.id
            AND (
              tl.support_ticket_id = st.id
              OR tl.zendesk_ticket_id = st.external_ticket_id::bigint
            )
       )
ON CONFLICT (organization_id, zendesk_ticket_id) DO UPDATE
  SET support_ticket_id = EXCLUDED.support_ticket_id,
      entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      updated_at = NOW();

-- ── Backfill 4: unfound_overlay.zendesk_ticket_id → RECEIVING link ─────────
INSERT INTO support_tickets (organization_id, provider, external_ticket_id)
SELECT DISTINCT ov.organization_id, 'zendesk', regexp_replace(trim(ov.zendesk_ticket_id), '^#', '')
  FROM unfound_overlay ov
 WHERE ov.zendesk_ticket_id IS NOT NULL
   AND ov.source_kind = 'unmatched_receiving'
   AND trim(ov.zendesk_ticket_id) ~ '^#?[0-9]{1,12}$'
   AND ov.source_id ~ '^[0-9]+$'
ON CONFLICT DO NOTHING;

INSERT INTO ticket_links (organization_id, support_ticket_id, zendesk_ticket_id, entity_type, entity_id)
SELECT ov.organization_id,
       st.id,
       st.external_ticket_id::bigint,
       'RECEIVING',
       ov.source_id::bigint
  FROM unfound_overlay ov
  JOIN support_tickets st
    ON st.organization_id = ov.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = regexp_replace(trim(ov.zendesk_ticket_id), '^#', '')
 WHERE ov.zendesk_ticket_id IS NOT NULL
   AND ov.source_kind = 'unmatched_receiving'
   AND ov.source_id ~ '^[0-9]+$'
   AND NOT EXISTS (
         SELECT 1 FROM ticket_links tl
          WHERE tl.organization_id = ov.organization_id
            AND tl.zendesk_ticket_id = st.external_ticket_id::bigint
       )
ON CONFLICT (organization_id, zendesk_ticket_id) DO UPDATE
  SET support_ticket_id = EXCLUDED.support_ticket_id,
      entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      updated_at = NOW();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('support_tickets');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — support_tickets left without FORCE RLS';
  END IF;
END $$;

COMMIT;
