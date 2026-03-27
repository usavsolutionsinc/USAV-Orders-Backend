-- Repair issue templates: DB-driven issue selection per SKU via favorite_skus FK
-- favorite_sku_id = NULL means global issue (shown for all repairs)

CREATE TABLE IF NOT EXISTS repair_issue_templates (
  id SERIAL PRIMARY KEY,
  favorite_sku_id INTEGER REFERENCES favorite_skus(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_issue_templates_favorite
  ON repair_issue_templates (favorite_sku_id, active, sort_order);

-- Seed current hard-coded global reasons
INSERT INTO repair_issue_templates (label, sort_order) VALUES
  ('Please wait', 10),
  ('Skip', 20),
  ('No sound', 30),
  ('Speaker Buzz', 40),
  ('CD Issues', 50),
  ('LCD Issues', 60);
