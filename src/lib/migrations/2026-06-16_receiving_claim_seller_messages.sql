-- Seller-facing claim message drafts (marketplace / eBay copy).
-- Distinct from Zendesk internal ticket body — plain text, no URLs per platform TOS.
-- One active draft per receiving carton or line (NULL line = carton-level).

BEGIN;

CREATE TABLE IF NOT EXISTS receiving_claim_seller_messages (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  receiving_id        INTEGER NOT NULL REFERENCES receiving(id) ON DELETE CASCADE,
  receiving_line_id   INTEGER REFERENCES receiving_lines(id) ON DELETE CASCADE,
  entity_line_key     INTEGER GENERATED ALWAYS AS (COALESCE(receiving_line_id, 0)) STORED,
  zendesk_ticket_id   BIGINT,
  seller_message      TEXT NOT NULL,
  subject_snapshot    TEXT,
  model               TEXT,
  created_by          INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receiving_claim_seller_messages_body_chk
    CHECK (length(btrim(seller_message)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rcv_claim_seller_msg_entity
  ON receiving_claim_seller_messages (organization_id, receiving_id, entity_line_key);

CREATE INDEX IF NOT EXISTS idx_rcv_claim_seller_msg_ticket
  ON receiving_claim_seller_messages (organization_id, zendesk_ticket_id)
  WHERE zendesk_ticket_id IS NOT NULL;

COMMENT ON TABLE receiving_claim_seller_messages IS
  'AI/operator seller-facing claim message drafts for receiving claims (no URLs).';

COMMIT;
