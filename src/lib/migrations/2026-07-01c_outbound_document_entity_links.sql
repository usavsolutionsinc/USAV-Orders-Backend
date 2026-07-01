-- 2026-07-01c_outbound_document_entity_links.sql
-- docs/outbound-documents-plan.md Phase 0 — link hub for outbound documents
-- (shipping labels + packing slips) stored in the existing `documents` table.
-- Mirrors `photo_entity_links` (2026-06-18_photos_platform_side_tables.sql):
-- one document can link to both its owning ORDER and its SHIPMENT (STN), so a
-- split multi-box order attaches the right label to the right tracking number.
--
-- Tenant-scoped from birth: organization_id NOT NULL, enforced via the
-- enforce_tenant_isolation() helper (2026-06-14_rls_enforcement_infra.sql) so the
-- loud-fail DEFAULT + FORCE RLS + canonical tenant_isolation policy land in one
-- shot. Safe because the only writer (src/lib/documents/links.ts, landing in
-- Phase 1) runs inside withTenantTransaction (sets app.current_org) AND stamps
-- organization_id explicitly — same precedent as media_library_saved_views.
--
-- Also adds a partial unique index on the existing `documents` table so a
-- marketplace re-fetch (same platform + order + doc type + STN) is a dedupe
-- no-op rather than a duplicate row (see OutboundDocumentData.sourceHash,
-- Phase 1 domain layer).
--
-- Also adds a partial unique index on the manual-attach URL, so two
-- concurrent identical `attachOutboundDocument` calls (client retry, double
-- click) can't both pass the app-level dupe check and create two rows — the
-- second hits a unique-violation that the domain layer maps to the same
-- OutboundDocumentConflictError (see src/lib/documents/outbound-documents.ts).
--
-- ROLLBACK: select relax_tenant_isolation('document_entity_links');
--           then DROP TABLE IF EXISTS document_entity_links;
--           DROP INDEX IF EXISTS ux_documents_outbound_source_hash;
--           DROP INDEX IF EXISTS ux_documents_outbound_url;

CREATE TABLE IF NOT EXISTS document_entity_links (
  id              BIGSERIAL PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,                       -- no DEFAULT here; helper installs the loud-fail GUC default
  entity_type     TEXT NOT NULL,   -- 'ORDER' | 'SHIPMENT'
  entity_id       BIGINT NOT NULL, -- orders.id | shipping_tracking_numbers.id
  link_role       TEXT NOT NULL DEFAULT 'primary',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_document_entity_links_entity_type
    CHECK (entity_type IN ('ORDER', 'SHIPMENT')),
  CONSTRAINT chk_document_entity_links_link_role
    CHECK (link_role IN ('primary', 'secondary')),
  CONSTRAINT ux_document_entity_links_unique
    UNIQUE (document_id, entity_type, entity_id, link_role)
);

CREATE INDEX IF NOT EXISTS idx_document_entity_links_entity
  ON document_entity_links (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_document_entity_links_document
  ON document_entity_links (document_id);

-- Flip on FORCE RLS + loud-fail org default + canonical policy, if the
-- enforcement infra is present (it is, post-2026-06-14). Guarded so a fresh DB
-- without the helper still gets the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('document_entity_links');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — document_entity_links left without FORCE RLS';
  END IF;
END $$;

-- Marketplace-fetch idempotency: re-fetching the same (org, document_type,
-- sourceHash) upserts instead of duplicating. sourceHash is only ever present
-- on outbound doc types (see OutboundDocumentData); older/unrelated document
-- rows (e.g. intake_agreement) are untouched by this index.
CREATE UNIQUE INDEX IF NOT EXISTS ux_documents_outbound_source_hash
  ON documents (organization_id, document_type, (document_data->>'sourceHash'))
  WHERE document_type IN ('shipping_label', 'packing_slip')
    AND document_data->>'sourceHash' IS NOT NULL;

-- Manual-attach idempotency: the same (org, document_type, order, url) can
-- only ever exist once. entity_type is not part of the key — every new write
-- normalizes to 'ORDER' (see attachOutboundDocument), and legacy
-- 'SHIPPING_LABEL' rows are normalized by the 2026-07-01d backfill before
-- this index would ever see a collision candidate.
CREATE UNIQUE INDEX IF NOT EXISTS ux_documents_outbound_url
  ON documents (organization_id, document_type, entity_id, (document_data->>'url'))
  WHERE document_type IN ('shipping_label', 'packing_slip')
    AND document_data->>'url' IS NOT NULL;
