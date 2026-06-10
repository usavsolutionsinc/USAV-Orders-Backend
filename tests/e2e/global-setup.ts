import { chromium, request as pwRequest, type FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const STORAGE = path.join(__dirname, '..', '.auth', 'admin.json');

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';
  const stafName = process.env.PW_STAFF_NAME || 'Michael';

  fs.mkdirSync(path.dirname(STORAGE), { recursive: true });

  // Reuse an already-valid saved session before falling back to a UI sign-in.
  // The UI flow only works under the pinless rollout (AUTH_PINLESS_SIGNIN);
  // with the PIN gate on, a pre-seeded session (e.g. minted for CI) is reused.
  if (fs.existsSync(STORAGE)) {
    try {
      const ctx = await pwRequest.newContext({ baseURL, storageState: STORAGE });
      const probe = await ctx.get('/api/receiving-lines?view=recent&limit=1');
      await ctx.dispose();
      if (probe.ok()) return;
    } catch {
      /* fall through to interactive sign-in */
    }
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/signin?next=/receiving`);
  await page.getByRole('button', { name: new RegExp(`Sign in as ${stafName}`, 'i') }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 15_000 });

  await context.storageState({ path: STORAGE });
  await browser.close();
}
