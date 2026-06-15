/**
 * Phase 4 — migrate USAV's Zoho connection into the per-tenant vault.
 *
 *   npx tsx scripts/migrate-zoho-to-vault.ts            # DRY RUN (read-only)
 *   npx tsx scripts/migrate-zoho-to-vault.ts --apply    # writes the vault row
 *
 * Moves the durable Zoho secret out of the legacy plaintext store
 * (ebay_accounts.ZOHO_MAIN.refresh_token) and into organization_integrations
 * (provider='zoho') as an AES-256-GCM encrypted ZohoCredentials payload for the
 * USAV org. The Zoho org id + data center + app client id/secret come from the
 * ZOHO_* env vars (the same values the env fallback serves today), so the
 * payload is self-contained and the app keeps working before AND after.
 *
 * Idempotent: re-running overwrites the USAV 'zoho' row with the same data.
 * Requires INTEGRATION_KMS_KEY (encryption) and DATABASE_URL.
 *
 * After this runs and is verified, the ZOHO_* env vars and the env fallback can
 * be removed (Phase 5).
 */
import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const APPLY = process.argv.includes('--apply');

async function main() {
  const { USAV_ORG_ID } = await import('../src/lib/tenancy/constants');
  const { upsertIntegrationCredentials, getIntegrationCredentials } = await import(
    '../src/lib/integrations/credentials'
  );
  const { isIntegrationKmsConfigured } = await import('../src/lib/integrations/crypto');
  type ZohoCredentials = import('../src/lib/integrations/credentials').ZohoCredentials;

  if (!isIntegrationKmsConfigured()) {
    throw new Error('INTEGRATION_KMS_KEY is not set/invalid — cannot encrypt the vault payload.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // 1. Pull the legacy refresh token (preferred) and env config.
  const { rows } = await pool.query<{ refresh_token: string | null }>(
    `SELECT refresh_token FROM ebay_accounts WHERE account_name = 'ZOHO_MAIN' LIMIT 1`,
  );
  const legacyRefresh = (rows[0]?.refresh_token ?? '').trim();
  const envRefresh = (process.env.ZOHO_REFRESH_TOKEN ?? '').trim();
  const refreshToken = legacyRefresh || envRefresh;

  const clientId = (process.env.ZOHO_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.ZOHO_CLIENT_SECRET ?? '').trim();
  const zohoOrgId = (process.env.ZOHO_ORG_ID || process.env.ZOHO_ORGANIZATION_ID || '').trim();
  const domain = (process.env.ZOHO_DOMAIN ?? '').trim() || 'accounts.zoho.com';

  const missing = [
    ['refresh_token (ebay_accounts.ZOHO_MAIN or ZOHO_REFRESH_TOKEN)', refreshToken],
    ['ZOHO_CLIENT_ID', clientId],
    ['ZOHO_CLIENT_SECRET', clientSecret],
    ['ZOHO_ORG_ID', zohoOrgId],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new Error(`Cannot migrate — missing: ${missing.join(', ')}`);
  }

  const payload: ZohoCredentials = { clientId, clientSecret, refreshToken, orgId: zohoOrgId, domain };

  console.log('Source:');
  console.log(`  refresh_token: ${legacyRefresh ? 'ebay_accounts.ZOHO_MAIN' : 'ZOHO_REFRESH_TOKEN env'} (${refreshToken.slice(0, 6)}…)`);
  console.log(`  zoho org id:   ${zohoOrgId}`);
  console.log(`  data center:   ${domain}`);
  console.log(`  target:        organization_integrations(${USAV_ORG_ID}, 'zoho')`);

  const existing = await getIntegrationCredentials<ZohoCredentials>(USAV_ORG_ID, 'zoho');
  if (existing) {
    console.log(`  note:          a 'zoho' vault row already exists for USAV (will be overwritten).`);
  }

  // Refuse to persist a row whose creds don't actually work — this is the guard
  // against writing a broken vault row that, being vault-first, would SHADOW the
  // working legacy path. Run this script where ZOHO_CLIENT_ID/SECRET match the
  // refresh token (i.e. prod env), not a local env with mismatched app creds.
  const tokenUrl = `https://${domain}/oauth/v2/token`;
  const mintRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
    cache: 'no-store',
  });
  const mintBody = (await mintRes.json().catch(() => ({}))) as Record<string, unknown>;
  const mintOk = mintRes.ok && !mintBody.error && Boolean(mintBody.access_token);
  console.log(`  token mint check: ${mintOk ? 'OK' : `FAILED (${mintBody.error ?? mintRes.status})`}`);

  if (!mintOk) {
    console.error(
      '\n❌  These credentials do not mint a Zoho token — refusing to write a broken vault row.\n' +
        '    Ensure ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET match the refresh token (run with prod env),\n' +
        '    or reconnect Zoho via /api/zoho/oauth/authorize which writes a fresh vault row.',
    );
    await pool.end();
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — creds verified. Re-run with --apply to write the encrypted vault row.');
    await pool.end();
    return;
  }

  await upsertIntegrationCredentials({
    orgId: USAV_ORG_ID,
    provider: 'zoho',
    payload,
    displayLabel: `Migrated · org ${zohoOrgId}`,
    createdBy: null,
  });

  console.log('\n✅  Wrote encrypted Zoho credentials to the vault for USAV.');
  console.log('    Verify the app still reaches Zoho, then remove the ZOHO_* env vars + the env fallback (Phase 5).');
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
