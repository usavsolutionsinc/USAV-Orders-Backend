DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_feature_type_enum') THEN
    CREATE TYPE admin_feature_type_enum AS ENUM ('feature', 'bug_fix');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_feature_status_enum') THEN
    CREATE TYPE admin_feature_status_enum AS ENUM ('backlog', 'in_progress', 'done');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_feature_priority_enum') THEN
    CREATE TYPE admin_feature_priority_enum AS ENUM ('low', 'medium', 'high');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_features (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type admin_feature_type_enum NOT NULL DEFAULT 'feature',
  status admin_feature_status_enum NOT NULL DEFAULT 'backlog',
  priority admin_feature_priority_enum NOT NULL DEFAULT 'medium',
  page_area VARCHAR(100),
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_to_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  updated_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_features_type_idx
  ON admin_features (type);

CREATE INDEX IF NOT EXISTS admin_features_status_order_idx
  ON admin_features (status, is_active, sort_order, id);

CREATE INDEX IF NOT EXISTS admin_features_updated_at_idx
  ON admin_features (updated_at DESC);
