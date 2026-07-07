import { chromium, request as pwRequest, type FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const USAV_STORAGE = path.join(AUTH_DIR, 'admin.json');
const QA_STORAGE = path.join(AUTH_DIR, 'qa-admin.json');

async function probeSession(baseURL: string, storagePath: string): Promise<boolean> {
  if (!fs.existsSync(storagePath)) return false;
  try {
    const ctx = await pwRequest.newContext({ baseURL, storageState: storagePath });
    const probe = await ctx.get('/api/receiving-lines?view=recent&limit=1');
    await ctx.dispose();
    return probe.ok();
  } catch {
    return false;
  }
}

async function signInStaff(
  baseURL: string,
  staffName: string,
  storagePath: string,
): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/signin?next=/dashboard`);
  await page.getByRole('button', { name: new RegExp(`Sign in as ${staffName}`, 'i') }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 15_000 });

  await context.storageState({ path: storagePath });
  await browser.close();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';
  const usavStaff = process.env.PW_STAFF_NAME || 'Michael';
  const qaStaff = process.env.PW_QA_STAFF_NAME || 'QA Admin';

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // USAV dogfood session (default Playwright projects)
  if (!(await probeSession(baseURL, USAV_STORAGE))) {
    await signInStaff(baseURL, usavStaff, USAV_STORAGE);
  }

  // QA sandbox session (qa-desktop project) — best-effort; skip when org not provisioned
  if (!(await probeSession(baseURL, QA_STORAGE))) {
    try {
      await signInStaff(baseURL, qaStaff, QA_STORAGE);
    } catch (err) {
      console.warn(
        `[global-setup] QA session not minted for "${qaStaff}" — run pnpm provision:qa-org first.`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
