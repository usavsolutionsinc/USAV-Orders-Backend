import { chromium } from '@playwright/test';
import fs from 'fs';

// Ad-hoc screenshot loop: reuse the saved Playwright session so auth-gated
// /design-demo routes render; if the session is stale, re-sign-in via the
// pinless splash (same flow as tests/e2e/global-setup.ts) and re-save it.
//   node tests/shot.mjs <path> <outfile>
const route = process.argv[2] || '/design-demo/id-chips';
const out = process.argv[3] || '/tmp/shot.png';
const STORAGE = 'tests/.auth/admin.json';
const STAFF = process.env.PW_STAFF_NAME || 'Michael';
const baseURL = 'http://localhost:3000';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: fs.existsSync(STORAGE) ? STORAGE : undefined,
  baseURL,
  viewport: { width: 760, height: 520 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

await page.goto(route, { waitUntil: 'networkidle' });

if (page.url().includes('/signin')) {
  await page.goto(`${baseURL}/signin?next=${encodeURIComponent(route)}`);
  await page.getByRole('button', { name: new RegExp(`Sign in as ${STAFF}|^${STAFF}$`, 'i') }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15_000 });
  await ctx.storageState({ path: STORAGE });
  await page.goto(route, { waitUntil: 'networkidle' });
}

await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log(`shot -> ${out} (url: ${page.url()})`);
