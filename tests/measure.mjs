import { chromium } from '@playwright/test';

const b = await chromium.launch();
const ctx = await b.newContext({ storageState: 'tests/.auth/admin.json', baseURL: 'http://localhost:3000', deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto('/design-demo/id-chips', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
const rows = await p.$$('[data-row]');
for (const row of rows) {
  const name = await row.getAttribute('data-row');
  const m = await row.evaluate((el) => {
    const cell = el.querySelector('[data-track]');
    const svg = cell?.querySelector('svg');
    const sr = svg?.getBoundingClientRect();
    // content = from icon left to the cell's right edge of inner content
    const inner = cell?.firstElementChild?.getBoundingClientRect();
    return {
      iconLeft: sr ? Math.round(sr.left) : null,
      contentW: inner ? Math.round(inner.width) : null,
    };
  });
  console.log(`${(name || '').padEnd(22)} iconLeft=${m.iconLeft} contentW=${m.contentW}`);
}
await b.close();
