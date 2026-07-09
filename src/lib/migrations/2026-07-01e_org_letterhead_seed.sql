-- ============================================================================
-- 2026-07-01e: tenant letterhead seed (docs/cycle-forge-branding-spec.md §4.3)
-- ============================================================================
-- Cycle Forge is the platform brand (code constants, see
-- src/lib/branding/constants.ts); the workspace/org name + this letterhead
-- block is what prints on repair paper and walk-in receipts. Schema for the
-- `letterhead` key is policed in src/lib/tenancy/settings.ts (LetterheadSchema)
-- — this migration only backfills the dogfood tenant's settings jsonb so the
-- new fields aren't blank on day one. Additive + idempotent (safe to re-run).
-- ============================================================================

BEGIN;

UPDATE organizations
SET settings = settings || jsonb_build_object(
  'letterhead', jsonb_build_object(
    'addressLine1', '16161 Gothard St. Suite A',
    'addressLine2', 'Huntington Beach, CA 92647, United States',
    'phone', '(714) 596-6888',
    'email', 'info@usavsolutions.com'
  )
)
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND NOT (settings ? 'letterhead');

COMMIT;
