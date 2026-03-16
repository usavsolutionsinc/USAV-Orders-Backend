CREATE TABLE IF NOT EXISTS favorite_skus (
  id SERIAL PRIMARY KEY,
  ecwid_product_id VARCHAR(64),
  sku VARCHAR(255) NOT NULL,
  sku_normalized VARCHAR(255) NOT NULL UNIQUE,
  label TEXT NOT NULL,
  product_title TEXT,
  issue_template TEXT,
  default_price TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  updated_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorite_sku_workspaces (
  favorite_id INTEGER NOT NULL REFERENCES favorite_skus(id) ON DELETE CASCADE,
  workspace_key VARCHAR(32) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (favorite_id, workspace_key),
  CONSTRAINT favorite_sku_workspaces_workspace_key_check
    CHECK (workspace_key IN ('repair', 'sku-stock'))
);

CREATE INDEX IF NOT EXISTS idx_favorite_sku_workspaces_workspace_order
  ON favorite_sku_workspaces (workspace_key, is_active, sort_order, favorite_id);
