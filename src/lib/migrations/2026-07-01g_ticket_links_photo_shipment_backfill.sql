-- Backfill ticket_links from photo_entity_links (claims photos on receiving cartons)
-- and SHIPMENT (STN) links where a carton is anchored to a tracking number.
--
-- Read-time resolution also walks these paths (see getPrimarySupportTicketForReceiving),
-- but persisting links keeps scan/unfound paths fast and consistent.
--
-- Safety: INSERT…ON CONFLICT DO NOTHING on zendesk_ticket_id — never overwrites an
-- existing primary entity for a ticket.

BEGIN;

-- ── Backfill 5: ZENDESK_TICKET on receiving photos → support_tickets + RECEIVING link ─
INSERT INTO support_tickets (organization_id, provider, external_ticket_id)
SELECT DISTINCT pel_recv.organization_id, 'zendesk', pel_z.entity_id::text
  FROM photo_entity_links pel_recv
  JOIN photo_entity_links pel_z
    ON pel_z.photo_id = pel_recv.photo_id
   AND pel_z.organization_id = pel_recv.organization_id
   AND pel_z.entity_type = 'ZENDESK_TICKET'
 WHERE pel_recv.entity_type IN ('RECEIVING', 'RECEIVING_LINE')
   AND pel_z.entity_id > 0
ON CONFLICT DO NOTHING;

INSERT INTO ticket_links (organization_id, support_ticket_id, zendesk_ticket_id, entity_type, entity_id)
SELECT pel_recv.organization_id,
       st.id,
       pel_z.entity_id::bigint,
       CASE
         WHEN pel_recv.entity_type = 'RECEIVING_LINE' THEN 'RECEIVING_LINE'
         ELSE 'RECEIVING'
       END,
       pel_recv.entity_id
  FROM photo_entity_links pel_recv
  JOIN photo_entity_links pel_z
    ON pel_z.photo_id = pel_recv.photo_id
   AND pel_z.organization_id = pel_recv.organization_id
   AND pel_z.entity_type = 'ZENDESK_TICKET'
  JOIN support_tickets st
    ON st.organization_id = pel_recv.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = pel_z.entity_id::text
 WHERE pel_recv.entity_type IN ('RECEIVING', 'RECEIVING_LINE')
   AND pel_z.entity_id > 0
ON CONFLICT (organization_id, zendesk_ticket_id) DO NOTHING;

UPDATE ticket_links tl
   SET support_ticket_id = st.id
  FROM support_tickets st
 WHERE tl.support_ticket_id IS NULL
   AND st.organization_id = tl.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = tl.zendesk_ticket_id::text;

-- ── Backfill 6: SHIPMENT (STN id) when carton has shipment_id + claim photos ─────────
INSERT INTO ticket_links (organization_id, support_ticket_id, zendesk_ticket_id, entity_type, entity_id)
SELECT DISTINCT r.organization_id,
       st.id,
       pel_z.entity_id::bigint,
       'SHIPMENT',
       r.shipment_id
  FROM receiving r
  JOIN photo_entity_links pel_recv
    ON pel_recv.organization_id = r.organization_id
   AND pel_recv.entity_type = 'RECEIVING'
   AND pel_recv.entity_id = r.id
  JOIN photo_entity_links pel_z
    ON pel_z.photo_id = pel_recv.photo_id
   AND pel_z.organization_id = pel_recv.organization_id
   AND pel_z.entity_type = 'ZENDESK_TICKET'
  JOIN support_tickets st
    ON st.organization_id = r.organization_id
   AND st.provider = 'zendesk'
   AND st.external_ticket_id = pel_z.entity_id::text
 WHERE r.shipment_id IS NOT NULL
   AND pel_z.entity_id > 0
   AND NOT EXISTS (
         SELECT 1 FROM ticket_links existing
          WHERE existing.organization_id = r.organization_id
            AND existing.zendesk_ticket_id = pel_z.entity_id::bigint
       )
ON CONFLICT (organization_id, zendesk_ticket_id) DO NOTHING;

COMMIT;
