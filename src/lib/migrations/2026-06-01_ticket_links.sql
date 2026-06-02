-- Ticket links — universal Zendesk ticket ↔ internal entity map.
--
-- Why: photos for a ticket live in our Vercel Blob (the `photos` table, keyed
-- by entity_type/entity_id), NOT as Zendesk attachments. To render a ticket's
-- photos (and, later, cross-entity chips) we need to know which internal record
-- a Zendesk ticket belongs to.
--
-- Today only unfound-queue tickets carry that link (unfound_overlay.zendesk_ticket_id).
-- This table makes the mapping universal and is written at ticket-creation time
-- by every path that opens a Zendesk ticket (claim route, direct createTicket,
-- unfound push). It complements — does not replace — unfound_overlay.
--
-- Resolution order at read time (see src/lib/zendesk-links.ts#getTicketEntity):
--   1. ticket_links   2. ticket.external_id   3. unfound_overlay
--
-- One ticket maps to one primary entity (UNIQUE on org + ticket). One entity may
-- have many tickets (multiple claims) — the entity index is non-unique.

BEGIN;

CREATE TABLE IF NOT EXISTS ticket_links (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  zendesk_ticket_id BIGINT NOT NULL,
  entity_type       TEXT   NOT NULL,   -- 'RECEIVING' | 'RECEIVING_LINE' | 'REPAIR' | ...
  entity_id         BIGINT NOT NULL,
  created_by        INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, zendesk_ticket_id)
);

-- Reverse lookup: "which tickets reference this entity?"
CREATE INDEX IF NOT EXISTS idx_ticket_links_entity
  ON ticket_links (entity_type, entity_id);

COMMIT;
