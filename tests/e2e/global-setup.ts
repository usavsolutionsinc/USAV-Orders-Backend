import { chromium, type FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const STORAGE = path.join(__dirname, '..', '.auth', 'admin.json');

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';
  const stafName = process.env.PW_STAFF_NAME || 'Michael';

  fs.mkdirSync(path.dirname(STORAGE), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/signin?next=/receiving`);
  await page.getByRole('button', { name: new RegExp(`Sign in as ${stafName}`, 'i') }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 15_000 });

  await context.storageState({ path: STORAGE });
  await browser.close();
}
