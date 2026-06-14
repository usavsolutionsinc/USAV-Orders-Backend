-- ============================================================================
-- 2026-06-13g_platform_account_type_catalog.sql
--
-- Step 1 of docs/platform-account-type-catalog-plan.md — promote the hardcoded
-- platform + receiving-type lists into three org-scoped, CRUD-able catalog
-- tables so each org can add / rename / hide / reorder its own platforms and
-- flow types without a code change.
--
--   platforms          ← CHANNEL (was SOURCE_PLATFORMS in src/lib/source-platform.ts)
--   platform_accounts  ← STOREFRONT under a channel (generalizes ebay_accounts)
--   types              ← per-org FLOW (was RECEIVING_TYPE_OPTS)
--
-- Additive + reversible. No FK is added to receiving/orders here (that is a
-- later step); the existing source_platform / intake_type text columns stay as
-- the denormalized cache. Seeds the built-in lists per existing org so nothing
-- regresses; the seed is idempotent (ON CONFLICT DO NOTHING) and orgs that
-- never customize simply carry the built-in rows.
-- ============================================================================

-- ─── platforms ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platforms (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            text NOT NULL,            -- 'ebay','amazon','ecwid','goodwill','fba',<custom>
  label           text NOT NULL,
  tone            text,                     -- pill color token (was hardcoded in source-platform.ts)
  provider        text,                     -- soft-link → organization_integrations.provider (null = display-only)
  sort_order      int  NOT NULL DEFAULT 100,
  is_active       boolean NOT NULL DEFAULT true,
  -- Seeded built-in (vs an org's own custom row). System rows are hide-only:
  -- label/tone/order editable, slug immutable, never hard-deleted.
  is_system       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platforms_org_slug
  ON platforms (organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_platforms_org
  ON platforms (organization_id);

DROP TRIGGER IF EXISTS platforms_touch_updated_at ON platforms;
CREATE TRIGGER platforms_touch_updated_at
  BEFORE UPDATE ON platforms
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─── platform_accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_accounts (
  id                bigserial PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform_id       bigint NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  slug              text NOT NULL,          -- 'ebay-mk','ebay-usav','ecwid-main'
  label             text NOT NULL,
  integration_scope text,                   -- → organization_integrations.scope (the specific connection)
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_accounts_org_platform_slug
  ON platform_accounts (organization_id, platform_id, slug);
CREATE INDEX IF NOT EXISTS idx_platform_accounts_org_platform
  ON platform_accounts (organization_id, platform_id);

DROP TRIGGER IF EXISTS platform_accounts_touch_updated_at ON platform_accounts;
CREATE TRIGGER platform_accounts_touch_updated_at
  BEFORE UPDATE ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─── types ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS types (
  id                  bigserial PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug                text NOT NULL,        -- 'po','return','trade_in','pickup',<custom>
  label               text NOT NULL,
  kind                text NOT NULL DEFAULT 'receiving', -- 'receiving' | 'shipping' | 'both'
  platform_account_id bigint REFERENCES platform_accounts(id) ON DELETE SET NULL,
  workflow_node_id    text,                 -- optional: drives a custom node-graph flow (station builder)
  is_return           boolean NOT NULL DEFAULT false,
  sort_order          int  NOT NULL DEFAULT 100,
  is_active           boolean NOT NULL DEFAULT true,
  -- Seeded built-in (vs an org's own custom row). See platforms.is_system.
  is_system           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_types_org_slug
  ON types (organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_types_org
  ON types (organization_id);

DROP TRIGGER IF EXISTS types_touch_updated_at ON types;
CREATE TRIGGER types_touch_updated_at
  BEFORE UPDATE ON types
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─── Seed built-ins per existing org (idempotent) ───────────────────────────
-- platforms ← SOURCE_PLATFORMS (slug/label/tone). provider left NULL here;
-- provider→integration linkage is a later step.
INSERT INTO platforms (organization_id, slug, label, tone, sort_order, is_system)
SELECT o.id, s.slug, s.label, s.tone, s.sort_order, true
FROM organizations o
CROSS JOIN (VALUES
  ('ebay',       'eBay',       'text-yellow-500', 10),
  ('amazon',     'Amazon',     'text-orange-600', 20),
  ('fba',        'FBA',        'text-orange-600', 30),
  ('aliexpress', 'AliExpress', 'text-red-500',    40),
  ('walmart',    'Walmart',    'text-amber-700',  50),
  ('goodwill',   'Goodwill',   'text-sky-600',    60),
  ('ecwid',      'ECWID-RS',   'text-blue-600',   70),
  ('other',      'Other',      'text-slate-500',  99)
) AS s(slug, label, tone, sort_order)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- types ← RECEIVING_TYPE_OPTS.
INSERT INTO types (organization_id, slug, label, kind, is_return, sort_order, is_system)
SELECT o.id, t.slug, t.label, t.kind, t.is_return, t.sort_order, true
FROM organizations o
CROSS JOIN (VALUES
  ('po',       'PO',       'both',      false, 10),
  ('return',   'Return',   'receiving', true,  20),
  ('trade_in', 'Trade In', 'receiving', false, 30),
  ('pickup',   'Pick Up',  'receiving', false, 40)
) AS t(slug, label, kind, is_return, sort_order)
ON CONFLICT (organization_id, slug) DO NOTHING;
