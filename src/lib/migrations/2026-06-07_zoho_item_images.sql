-- Zoho item photos.
--
-- The Zoho Inventory items-list API returns `image_document_id` (+ image_name)
-- for items that have a photo, but NOT a usable URL — the bytes must be fetched
-- per item from GET /inventory/v1/items/{id}/image. We capture the document id
-- during the normal item sync, then serve each photo through a lazy proxy
-- (/api/zoho/items/[id]/image) that fetches once from Zoho and caches the bytes
-- here. Keyed by zoho_item_id; document_id lets us detect when the photo changed.

ALTER TABLE items ADD COLUMN IF NOT EXISTS image_document_id text;

CREATE TABLE IF NOT EXISTS zoho_item_images (
  zoho_item_id text PRIMARY KEY,
  document_id  text,
  content_type text NOT NULL,
  bytes        bytea NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
