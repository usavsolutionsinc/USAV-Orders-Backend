-- Final mobile bottom-nav layout: Home · Receiving · [Scan big centre] · Picks · Sign out.
--
-- The big centre button is the universal QR/barcode scanner ('scan' → /m/scan,
-- used for everything). 'receiving' is a normal tab (→ /m/receive) used only to
-- scan received-at-the-door tracking numbers.
--
-- Supersedes 2026-06-04_mobile_nav_scan_to_receive.sql (which had swapped the
-- centre to 'receive'). Sets the canonical 5-item tab array for any role/staff
-- whose bottomNav.tabs is configured. Idempotent.

UPDATE roles
   SET mobile_defaults = jsonb_set(
         mobile_defaults,
         '{bottomNav,tabs}',
         '["home","receiving","scan","picks","signout"]'::jsonb
       )
 WHERE mobile_defaults IS NOT NULL
   AND mobile_defaults->'bottomNav'->'tabs' IS NOT NULL
   AND mobile_defaults->'bottomNav'->'tabs'
         <> '["home","receiving","scan","picks","signout"]'::jsonb;

UPDATE staff
   SET mobile_display_config = jsonb_set(
         mobile_display_config,
         '{bottomNav,tabs}',
         '["home","receiving","scan","picks","signout"]'::jsonb
       )
 WHERE mobile_display_config IS NOT NULL
   AND mobile_display_config->'bottomNav'->'tabs' IS NOT NULL
   AND mobile_display_config->'bottomNav'->'tabs'
         <> '["home","receiving","scan","picks","signout"]'::jsonb;
