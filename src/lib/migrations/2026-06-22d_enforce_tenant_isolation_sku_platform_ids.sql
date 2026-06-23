-- ============================================================================
-- 2026-06-22d_enforce_tenant_isolation_sku_platform_ids.sql
--
-- FORCE RLS on sku_platform_ids. The 2026-06-22 orders/items-core classification
-- found it has ZERO direct raw-pool route touchers — every consumer goes through
-- the already-org-scoped sku-catalog-queries helpers. org_id NOT NULL + armed
-- policy present. Dual-pool-safe; revert via relax_tenant_isolation('sku_platform_ids').
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.sku_platform_ids') IS NOT NULL THEN
    BEGIN
      PERFORM enforce_tenant_isolation('sku_platform_ids');
      RAISE NOTICE 'FORCEd sku_platform_ids';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'enforce(sku_platform_ids) failed: % — left unforced', SQLERRM;
    END;
  END IF;
END $$;
