-- Mobile bottom-nav layout: Recent · Incoming · [Scan big centre] · Packing · Picks.
--
-- Renames are label-only (handled in RedesignedBottomNav TAB_META): 'home' now
-- reads "Recent", 'receiving' reads "Incoming". This migration only changes the
-- stored tab ORDER and SET — dropping 'signout' from the bar (sign-out lives in
-- the account FAB) and inserting the new 'packing' tab (→ /packer) to the left
-- of 'picks' (→ /m/pick).
--
-- Supersedes 2026-06-04b_mobile_nav_receiving_tab.sql. Idempotent.

UPDATE roles
   SET mobile_defaults = jsonb_set(
         mobile_defaults,
         '{bottomNav,tabs}',
         '["home","receiving","scan","packing","picks"]'::jsonb
       )
 WHERE mobile_defaults IS NOT NULL
   AND mobile_defaults->'bottomNav'->'tabs' IS NOT NULL
   AND mobile_defaults->'bottomNav'->'tabs'
         <> '["home","receiving","scan","packing","picks"]'::jsonb;

UPDATE staff
   SET mobile_display_config = jsonb_set(
         mobile_display_config,
         '{bottomNav,tabs}',
         '["home","receiving","scan","packing","picks"]'::jsonb
       )
 WHERE mobile_display_config IS NOT NULL
   AND mobile_display_config->'bottomNav'->'tabs' IS NOT NULL
   AND mobile_display_config->'bottomNav'->'tabs'
         <> '["home","receiving","scan","packing","picks"]'::jsonb;
