-- Support ticket assignments — in-website staff ownership of a Zendesk ticket.
--
-- Why: the Zendesk `assignee_id` is the Zendesk-side agent. This app is staff-aware
-- and wants its OWN assignment that is independent of Zendesk: assigning a ticket to
-- a staffer drops a notification into their inbox bell (a staff_message) so they
-- follow up. This table holds the durable "who owns this ticket here" fact; the
-- notification side reuses staff_messages + publishStaffMessage.
--
-- One ticket has at most one in-website owner (UNIQUE on org + ticket); re-assigning
-- upserts. Clearing the assignment deletes the row.
--
-- Tenant-from-birth: organization_id NOT NULL, defaulted from the app.current_org GUC
-- so writes under withTenantTransaction auto-stamp; per-org uniqueness.

BEGIN;

CREATE TABLE IF NOT EXISTS support_ticket_assignments (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  zendesk_ticket_id BIGINT  NOT NULL,
  assigned_staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  assigned_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, zendesk_ticket_id)
);

-- Reverse lookup: "which tickets is this staffer on the hook for?"
CREATE INDEX IF NOT EXISTS idx_support_ticket_assignments_staff
  ON support_ticket_assignments (organization_id, assigned_staff_id);

COMMIT;
