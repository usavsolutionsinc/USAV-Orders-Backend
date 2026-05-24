-- ============================================================================
-- 2026-05-24_ebay_accounts_multi_tenant.sql
--
-- Ensures the ebay_accounts table has organization_id column, populated,
-- and adds a unique index on (organization_id, ebay_user_id).
-- ============================================================================

DO $$
DECLARE
  col_exists boolean;
BEGIN
  -- 1. Check if organization_id exists, and if not, add it with USAV Org default
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'ebay_accounts' 
      AND column_name = 'organization_id'
  ) INTO col_exists;

  IF NOT col_exists THEN
    ALTER TABLE ebay_accounts 
      ADD COLUMN organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
    
    ALTER TABLE ebay_accounts 
      ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid;
      
    ALTER TABLE ebay_accounts 
      ADD CONSTRAINT ebay_accounts_organization_fk 
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

    CREATE INDEX IF NOT EXISTS idx_ebay_accounts_organization ON ebay_accounts (organization_id);
    
    ALTER TABLE ebay_accounts ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS ebay_accounts_tenant_isolation ON ebay_accounts;
    CREATE POLICY ebay_accounts_tenant_isolation ON ebay_accounts 
      USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
  END IF;

  -- 2. Populate any nulls in case the column existed but was nullable or unpopulated
  UPDATE ebay_accounts 
    SET organization_id = '00000000-0000-0000-0000-000000000001' 
    WHERE organization_id IS NULL;

  -- 3. Create the unique index on (organization_id, ebay_user_id)
  CREATE UNIQUE INDEX IF NOT EXISTS ux_ebay_accounts_org_ebay_user 
    ON ebay_accounts (organization_id, ebay_user_id);
END $$;
