-- Migration: add thumbnail_url for first-page PDF previews
--
-- Why: with a few hundred manuals already in the library and more coming,
-- name-based scanning in the sidebar is slow. Storing a small PNG preview
-- (rendered client-side from page 1 on upload) lets the file list show
-- visual cards instead of generic file icons.
--
-- Thumbnails are nullable on purpose. Legacy rows without one fall back
-- to the existing file-icon glyph; a lazy backfill (the ManualLibrary
-- viewer regenerates and POSTs the thumb the first time you open the
-- manual) eventually fills them in.

ALTER TABLE product_manuals
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
