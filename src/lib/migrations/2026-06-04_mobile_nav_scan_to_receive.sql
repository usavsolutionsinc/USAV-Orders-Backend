-- Flip the mobile bottom-nav center button from the universal order scanner
-- ('scan' → /m/scan) to the receiving-door scan ('receive' → /m/receive).
--
-- The 2026-05-25_mobile_display_config seed wrote tabs
--   ['home','scan','picks','signout']
-- into roles.mobile_defaults for the bottom-nav-enabled roles, and that DB
-- value overrides the code DEFAULT — so the new 'receive' center tab never
-- appeared until this swap runs. Idempotent: once no 'scan' remains in a
-- tabs array the WHERE clause stops matching.
--
-- Anyone who still needs the universal scanner can re-add 'scan' per-staff
-- from /admin?section=access → Mobile display (the sanitizer prefers 'receive'
-- when both are present, so Receive stays the center button).

-- Roles: swap 'scan' → 'receive' inside bottomNav.tabs.
UPDATE roles
   SET mobile_defaults = jsonb_set(
         mobile_defaults,
         '{bottomNav,tabs}',
         (
           SELECT jsonb_agg(
                    CASE WHEN elem = '"scan"'::jsonb THEN '"receive"'::jsonb ELSE elem END
                  )
           FROM jsonb_array_elements(mobile_defaults->'bottomNav'->'tabs') AS elem
         )
       )
 WHERE mobile_defaults IS NOT NULL
   AND mobile_defaults->'bottomNav'->'tabs' @> '["scan"]'::jsonb;

-- Per-staff overrides: same swap.
UPDATE staff
   SET mobile_display_config = jsonb_set(
         mobile_display_config,
         '{bottomNav,tabs}',
         (
           SELECT jsonb_agg(
                    CASE WHEN elem = '"scan"'::jsonb THEN '"receive"'::jsonb ELSE elem END
                  )
           FROM jsonb_array_elements(mobile_display_config->'bottomNav'->'tabs') AS elem
         )
       )
 WHERE mobile_display_config IS NOT NULL
   AND mobile_display_config->'bottomNav'->'tabs' @> '["scan"]'::jsonb;
