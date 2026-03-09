-- Extend ebay_accounts into a universal platform OAuth token store.
-- Adds a platform column; seeds a ZOHO_MAIN row for Zoho Inventory tokens.

ALTER TABLE ebay_accounts
  ADD COLUMN IF NOT EXISTS platform VARCHAR(20);

-- Back-fill existing eBay rows
UPDATE ebay_accounts SET platform = 'EBAY' WHERE platform IS NULL;

-- Seed placeholder Zoho row — access/refresh tokens populated by OAuth callback
INSERT INTO ebay_accounts (
  account_name,
  platform,
  access_token,
  refresh_token,
  token_expires_at,
  refresh_token_expires_at,
  is_active
) VALUES (
  'ZOHO_MAIN',
  'ZOHO',
  '',
  '',
  NOW(),
  NOW() + INTERVAL '10 years',
  true
) ON CONFLICT (account_name) DO UPDATE
    SET platform = 'ZOHO',
        updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_ebay_accounts_platform ON ebay_accounts(platform);
