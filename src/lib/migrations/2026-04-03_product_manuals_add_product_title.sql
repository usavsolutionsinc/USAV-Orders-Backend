-- Migration: add product_title to product_manuals so read/write paths match
ALTER TABLE product_manuals
  ADD COLUMN IF NOT EXISTS product_title TEXT;
