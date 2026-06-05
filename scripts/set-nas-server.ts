/**
 * One-off: configure the receiving NAS address. Sets the TEST slot to the LAN
 * Caddy/WebDAV server and makes it active. The PROD slot stays empty until the
 * Cloudflare HTTPS hostname is wired (the live HTTPS app can't use an http LAN
 * URL — mixed content).
 *
 *   npx tsx scripts/set-nas-server.ts                       # default LAN address
 *   NAS_TEST_URL=https://nas.example npx tsx scripts/set-nas-server.ts
 */
import { updateOrgSettings, getOrganization } from '@/lib/tenancy/organizations';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

async function main() {
  const test = (process.env.NAS_TEST_URL || 'http://192.168.50.125:8088').replace(/\/+$/, '');
  const prod = (process.env.NAS_PROD_URL || '').replace(/\/+$/, '');
  const active = (process.env.NAS_ACTIVE === 'prod' ? 'prod' : 'test') as 'test' | 'prod';

  const before = await getOrganization(USAV_ORG_ID);
  console.log('before:', JSON.stringify(before?.settings.nasPhotoServers ?? null));

  await updateOrgSettings(USAV_ORG_ID, { nasPhotoServers: { test, prod, active } });

  const after = await getOrganization(USAV_ORG_ID);
  console.log('after: ', JSON.stringify(after?.settings.nasPhotoServers));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
