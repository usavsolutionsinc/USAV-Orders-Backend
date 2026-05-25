-- Unfound overlay trigger fix.
--
-- The original trigger (2026-05-22_unfound_overlay.sql) fired BEFORE UPDATE
-- only. That left two small holes:
--
--   1. First PATCH with `checked: true` is an INSERT via the upsert path —
--      the trigger never ran, so checked_at stayed NULL.
--   2. If the trigger ever did fire on INSERT it would crash on OLD.checked
--      (OLD doesn't exist on INSERT).
--
-- This migration rewrites the function to handle both events and re-creates
-- the trigger as BEFORE INSERT OR UPDATE. updated_at is always touched;
-- checked_at is stamped whenever NEW.checked transitions to TRUE (whether
-- that transition is a fresh insert or an update from FALSE).

BEGIN;

CREATE OR REPLACE FUNCTION unfound_overlay_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();

  IF TG_OP = 'INSERT' THEN
    -- Fresh row: stamp checked_at if it lands already checked.
    IF NEW.checked AND NEW.checked_at IS NULL THEN
      NEW.checked_at := NOW();
    END IF;
  ELSE
    -- UPDATE: stamp on the FALSE → TRUE transition, clear on TRUE → FALSE.
    IF NEW.checked IS DISTINCT FROM OLD.checked THEN
      NEW.checked_at := CASE WHEN NEW.checked THEN NOW() ELSE NULL END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unfound_overlay_touch_updated_at ON unfound_overlay;

CREATE TRIGGER trg_unfound_overlay_touch_updated_at
  BEFORE INSERT OR UPDATE ON unfound_overlay
  FOR EACH ROW
  EXECUTE FUNCTION unfound_overlay_touch_updated_at();

-- One-time backfill: any rows that were inserted as checked=TRUE under the
-- old trigger (which didn't fire on INSERT) have checked_at = NULL. Set
-- checked_at to updated_at as a best-effort approximation so the column
-- isn't unevenly populated.
UPDATE unfound_overlay
   SET checked_at = updated_at
 WHERE checked = TRUE
   AND checked_at IS NULL;

COMMIT;
