-- ============================================================================
-- 2026-06-26: photo_labels + photo_label_assignments — many-to-many photo tags
-- ============================================================================
-- The photo library's primary axis is the "image type" (one per photo, see
-- photo_image_types). LABELS are the orthogonal axis: a photo carries ONE type
-- but MANY labels describing *what the shot shows* (front / back / serial tag /
-- defect / accessories / box). They are especially load-bearing for listing
-- photos (a marketplace gallery is an ordered set of labeled angles) but apply
-- library-wide.
--
-- Two tables, mirroring the proven photo_image_types (vocabulary) +
-- photo_entity_links (join) split:
--   * photo_labels            — org-scoped label vocabulary. `key` is a slug
--                               matched at filter time; `color` is a SEMANTIC
--                               TOKEN name ('blue' / 'rose' / 'emerald' …) —
--                               NEVER a hex (chip classes are safelisted in
--                               Tailwind, see src/lib/photos/label-colors.ts).
--                               `scope_image_type` optionally narrows a label to
--                               one image type ('listing'); NULL = global.
--                               `is_system` rows are seeded + non-deletable.
--   * photo_label_assignments — photo_id ↔ label_id (UNIQUE), the filterable join.
--
-- Tenant-from-birth: organization_id UUID NOT NULL on both, enforced via
-- enforce_tenant_isolation() (loud-fail org DEFAULT + FORCE RLS + canonical
-- tenant_isolation policy). The only writers (lib/photos/labels.ts via the
-- /api/photos/labels* routes) run inside withTenantTransaction (SET LOCAL
-- app.current_org) AND pass organization_id explicitly on every write.
--
-- ROLLBACK:
--   select relax_tenant_isolation('photo_label_assignments');
--   select relax_tenant_isolation('photo_labels');
--   DROP TABLE IF EXISTS photo_label_assignments;
--   DROP TABLE IF EXISTS photo_labels;
-- ============================================================================

BEGIN;

-- ── The label vocabulary (org-scoped) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_labels (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL,                 -- no DEFAULT; helper installs the loud-fail GUC default
  key              TEXT NOT NULL,                 -- lowercased slug; matched at filter time
  label            TEXT NOT NULL,                 -- operator-facing name
  color            TEXT,                          -- SEMANTIC TOKEN name only ('blue','rose',…), never hex
  icon             TEXT,                          -- optional Icons.tsx glyph name
  scope_image_type TEXT,                          -- NULL = global; e.g. 'listing' = surfaced in listing flows
  is_system        BOOLEAN NOT NULL DEFAULT FALSE,-- seeded, non-deletable / non-renamable
  sort_index       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-org case-insensitive key uniqueness (the key is the filter token).
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_labels_org_key
  ON photo_labels (organization_id, lower(key));

CREATE INDEX IF NOT EXISTS idx_photo_labels_org_sort
  ON photo_labels (organization_id, sort_index, id);

COMMENT ON TABLE photo_labels IS
  'Org-scoped photo label vocabulary (many-to-many with photos via photo_label_assignments). One type per photo, many labels. color is a semantic token name, never hex.';

-- ── The assignment join (photo ↔ label) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_label_assignments (
  id                   BIGSERIAL PRIMARY KEY,
  photo_id             BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  label_id             BIGINT NOT NULL REFERENCES photo_labels(id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL,             -- no DEFAULT; helper installs the loud-fail GUC default
  assigned_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_photo_label_assignment UNIQUE (photo_id, label_id)
);

-- Powers the library label filter (org + label → which photos).
CREATE INDEX IF NOT EXISTS idx_photo_label_assign_label
  ON photo_label_assignments (organization_id, label_id);

-- Powers per-photo chip rendering (photo → its labels).
CREATE INDEX IF NOT EXISTS idx_photo_label_assign_photo
  ON photo_label_assignments (photo_id);

COMMENT ON TABLE photo_label_assignments IS
  'Join table: which labels are on which photo. UNIQUE(photo_id,label_id). Tenant-scoped.';

-- ── Seed the system listing labels per existing org ─────────────────────────
-- These describe the standard marketplace gallery angles. is_system = TRUE so
-- they cannot be renamed/deleted; scope_image_type = 'listing' surfaces them in
-- the listing flow (and globally via NULL where useful). Idempotent on the
-- per-org key unique index.
INSERT INTO photo_labels (organization_id, key, label, color, icon, scope_image_type, is_system, sort_index)
SELECT o.id, s.key, s.label, s.color, s.icon, 'listing', TRUE, s.sort_index
FROM organizations o
CROSS JOIN (VALUES
  ('cover',       'Cover',       'amber',   'Star',         0),
  ('front',       'Front',       'blue',    'Image',        1),
  ('back',        'Back',        'blue',    'Image',        2),
  ('serial-tag',  'Serial / label', 'violet','Tag',         3),
  ('accessories', 'Accessories', 'emerald', 'Package',      4),
  ('box',         'Box',         'slate',   'PackageOpen',  5),
  ('defect',      'Defect',      'rose',    'AlertTriangle',6)
) AS s(key, label, color, icon, sort_index)
ON CONFLICT (organization_id, lower(key)) DO NOTHING;

-- ── Flip on FORCE RLS + loud-fail org default + canonical policy ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('photo_labels');
    PERFORM enforce_tenant_isolation('photo_label_assignments');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — photo_labels left without FORCE RLS';
  END IF;
END $$;

COMMIT;
