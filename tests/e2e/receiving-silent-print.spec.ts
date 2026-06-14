import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Silent printing for the unbox-mode receiving Print button.
 *
 * Context: in a browser tab (not the Electron shell) the receiving label
 * reaches a driver-owned OS printer (e.g. CTP800BD installed as a Windows
 * printer) ONLY via the page's own `window.print()`. WebUSB can't claim a
 * driver-owned interface, so the raw path is skipped and the label is mounted
 * in a HIDDEN IFRAME whose embedded script calls `window.print()`. That print
 * is dialog-free when the browser runs with `--kiosk-printing` and the label
 * printer is the OS default.
 *
 * Two layers:
 *  1. Mechanism (deterministic): under the app's REAL response headers (CSP =
 *     `frame-ancestors 'self'`, no script-src), a srcdoc iframe carrying the
 *     receiving-label markup runs its inline script and calls window.print()
 *     exactly once, with a rendered DataMatrix. This is what `printHtmlInIframe`
 *     relies on.
 *  2. Wiring (best-effort): drive the real unbox Print button and assert it
 *     triggers a label print. Skips cleanly when no test carton resolves.
 */

// Launch the browser the way an operator must for silent printing.
test.use({ launchOptions: { args: ['--kiosk-printing'] } });

/** The exact <script> the receiving/product label HTML embeds (printLabel.ts /
 *  receiving-label-helpers.tsx). Mirrored here so the test asserts the real
 *  auto-print behavior, not a simplified stand-in. */
const LABEL_HTML = `<!doctype html><html><head><meta charset="utf-8"/><title>Receiving label</title>
<style>@page{size:2in 1in;margin:0}html,body{width:2in;height:1in;margin:0;padding:0;font-family:Arial}</style>
</head><body>
<div class="wrap">
  <div class="info"><span class="platform">eBay - PO</span><span class="po">1234</span></div>
  <div class="qr"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#fff"/><rect width="8" height="8" fill="#000"/></svg></div>
</div>
<script>
window.onload=function(){ setTimeout(function(){window.focus();window.print();},120); };
window.onafterprint=function(){setTimeout(function(){window.close();},80);};
</script>
</body></html>`;

test.describe('Receiving silent print', () => {
  // Mechanism layer needs no auth — /signin is a public same-origin document
  // that carries the app's real security headers.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('hidden-iframe label runs its inline script and prints once (kiosk-silent)', async ({ page }) => {
    const cspBlocked: string[] = [];
    page.on('console', (m) => {
      if (/content security policy|refused to execute/i.test(m.text())) cspBlocked.push(m.text());
    });

    await page.goto('/signin');

    // Confirm we're under the real app CSP and it does NOT restrict scripts.
    const csp = await page.evaluate(async () => {
      const res = await fetch(location.pathname, { method: 'GET' });
      return res.headers.get('content-security-policy');
    });
    expect(csp ?? '', 'app CSP should not gate inline scripts').not.toMatch(/script-src/i);

    const result = await page.evaluate(
      (html) =>
        new Promise<{ printed: number; hasSvg: boolean; threw: string | null }>((resolve) => {
          const iframe = document.createElement('iframe');
          iframe.style.cssText =
            'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
          let printed = 0;
          let threw: string | null = null;
          iframe.onload = () => {
            try {
              const cw = iframe.contentWindow as Window;
              // Hook BEFORE the embedded +120ms timeout fires. Replacing print
              // keeps headless from no-op'ing it and lets us count the call.
              (cw as unknown as { print: () => void }).print = () => {
                printed += 1;
              };
            } catch (e) {
              threw = e instanceof Error ? e.message : String(e);
            }
            // Wait past the embedded 120ms auto-print timeout, then report.
            setTimeout(() => {
              let hasSvg = false;
              try {
                hasSvg = !!iframe.contentDocument?.querySelector('svg');
              } catch {
                /* cross-origin guard — not expected for srcdoc */
              }
              resolve({ printed, hasSvg, threw });
              iframe.remove();
            }, 400);
          };
          document.body.appendChild(iframe);
          iframe.srcdoc = html;
        }),
      LABEL_HTML,
    );

    expect(cspBlocked, `CSP blocked the label script: ${cspBlocked.join('; ')}`).toEqual([]);
    expect(result.threw, 'hooking iframe print threw').toBeNull();
    expect(result.hasSvg, 'DataMatrix/QR did not render in the iframe').toBe(true);
    expect(result.printed, 'iframe label did not auto-print exactly once').toBe(1);
  });
});

// PowerShell helper: pause/resume the printer queue, list/clear its jobs.
const PRINTER_CTL_PS = `param([string]$Action,[string]$Printer)
$ErrorActionPreference='SilentlyContinue'
switch ($Action) {
  'pause'  { $c=Get-CimInstance Win32_Printer -Filter "Name='$Printer'"; Invoke-CimMethod -InputObject $c -MethodName Pause | Out-Null }
  'resume' { $c=Get-CimInstance Win32_Printer -Filter "Name='$Printer'"; Invoke-CimMethod -InputObject $c -MethodName Resume | Out-Null }
  'jobs'   { Get-PrintJob -PrinterName $Printer | ForEach-Object { "$($_.Id)|$($_.DocumentName)|$($_.JobStatus)" } }
  'clear'  { Get-PrintJob -PrinterName $Printer | Remove-PrintJob }
}`;

/**
 * PHYSICAL print check — actually drives a label out of the CTP800BD.
 *
 * Gated behind PW_PHYSICAL_PRINT=1 (it consumes a label and needs the printer
 * powered + loaded). Faithful to the real path: a hidden srcdoc iframe whose
 * embedded script calls the REAL window.print() (not hooked), under
 * `--kiosk-printing`, which prints to the Windows default printer (CTP800BD).
 *
 * It pauses the queue first so the spooled job is captured before it prints
 * (a thermal label clears in ~1s), asserts the job reached the CTP800BD queue,
 * then resumes so it physically prints and verifies the queue drains.
 */
test.describe('Physical print to CTP800BD', () => {
  test.skip(
    !process.env.PW_PHYSICAL_PRINT,
    'set PW_PHYSICAL_PRINT=1 to physically print a label',
  );
  // Public same-origin document is all this needs.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('kiosk-prints a real label that lands in the CTP800BD spool queue', async ({ page }) => {
    const PRINTER = process.env.PW_PRINTER || 'CTP800BD';
    const scriptPath = path.join(os.tmpdir(), 'usav-printer-ctl.ps1');
    fs.writeFileSync(scriptPath, PRINTER_CTL_PS, 'utf8');
    const ctl = (action: string): string =>
      execSync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" -Action ${action} -Printer "${PRINTER}"`,
        { encoding: 'utf8', timeout: 20_000 },
      ).trim();

    // Clean slate, then pause so the kiosk job is captured before it prints.
    ctl('resume');
    ctl('clear');
    ctl('pause');

    let spooled = '';
    try {
      await page.goto('/signin');
      const marker = `USAV-KIOSK-${Date.now()}`;
      // Faithful to printHtmlInIframe: hidden srcdoc iframe, embedded auto-print,
      // REAL window.print() (no hook) so a job is actually generated.
      await page.evaluate((m) => {
        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${m}</title>
<style>@page{size:2in 1in;margin:0}html,body{width:2in;height:1in;margin:0;padding:6px;font-family:Arial,sans-serif}.t{font-weight:900;font-size:12px}.s{font-size:9px;color:#444}</style></head>
<body><div class="t">USAV print check</div><div class="s">${m}</div>
<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#fff"/><rect x="2" y="2" width="10" height="10" fill="#000"/><rect x="44" y="2" width="10" height="10" fill="#000"/><rect x="2" y="44" width="10" height="10" fill="#000"/></svg>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},120);};</script></body></html>`;
        const f = document.createElement('iframe');
        f.setAttribute('aria-hidden', 'true');
        f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
        f.srcdoc = html;
        document.body.appendChild(f);
      }, marker);

      // Poll the paused queue (empty at start, so ANY job is ours).
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        spooled = ctl('jobs');
        if (spooled) break;
        await page.waitForTimeout(300);
      }
      expect(spooled, 'no print job reached the CTP800BD spool queue').not.toBe('');
      console.log(`[physical-print] spooled to ${PRINTER}:\n${spooled}`);
    } finally {
      // Resume so the captured job actually prints.
      ctl('resume');
    }

    // Confirm the printer consumes it (queue drains) — i.e. paper came out.
    const drainBy = Date.now() + 25_000;
    let remaining = ctl('jobs');
    while (remaining && Date.now() < drainBy) {
      await page.waitForTimeout(500);
      remaining = ctl('jobs');
    }
    expect(
      remaining,
      'job stuck in queue after resume — printer did not consume it (offline / out of media?)',
    ).toBe('');
  });
});

test.describe('Silent-print toggle', () => {
  // Settings → Hardware switch persists to localStorage and flips state.
  test('Hardware settings switch toggles + persists', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop settings only');
    await page.goto('/settings?section=hardware');

    const sw = page.getByRole('switch', { name: /silent printing/i });
    await expect(sw, 'Silent printing switch did not render').toBeVisible({ timeout: 15_000 });

    // Default is ON (no stored value yet).
    await expect(sw).toHaveAttribute('aria-checked', 'true');

    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => localStorage.getItem('usav.silentPrint'))).toBe('0');

    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('usav.silentPrint'))).toBe('1');
  });

  // End-to-end via the REAL switch: flip Silent printing OFF in Settings →
  // Hardware, then print a carton and assert the label routes to the dialog
  // path (window.print) instead of the paired raw printer. This is the exact
  // "turn it off and it should stop printing silently" flow.
  test('flipping the Hardware switch OFF routes labels to the dialog', async ({ page, request }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop unbox workspace only');

    const res = await request.get('/api/receiving-lines?view=active&limit=60');
    expect(res.ok()).toBeTruthy();
    const lines = (await res.json())?.receiving_lines ?? [];
    const hit = lines.find(
      (l: { receiving_id?: number; zoho_purchaseorder_number?: string }) =>
        l.receiving_id && (l.zoho_purchaseorder_number || '').trim(),
    );
    test.skip(!hit, 'no received carton with a PO available');

    // Persist across BOTH navigations (settings → receiving): a paired serial
    // label printer + a fake navigator.serial that records bytes, and a
    // window.print() counter covering injected iframes.
    await page.addInitScript(() => {
      localStorage.setItem(
        'usav.printerProfiles',
        JSON.stringify({
          version: 2,
          profiles: [
            {
              id: 'fake-serial',
              name: 'Fake serial',
              role: 'label',
              kind: 'serial',
              vendorId: 0x1234,
              productId: 0x5678,
              serialNumber: null,
              language: 'escpos',
              paperSizeId: '2x1',
              baudRate: 9600,
              copies: 1,
            },
          ],
          routing: { label: 'fake-serial' },
        }),
      );
      const w = window as unknown as { __serialBytes: number; __prints: number };
      w.__serialBytes = 0;
      w.__prints = 0;
      const fakePort = {
        getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
        open: async () => {},
        close: async () => {},
        writable: {
          getWriter: () => ({
            write: async (d: Uint8Array) => {
              w.__serialBytes += d.byteLength ?? d.length ?? 0;
            },
            releaseLock: () => {},
          }),
        },
      };
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: { getPorts: async () => [fakePort], requestPort: async () => fakePort },
      });
      const hook = (win: Window) => {
        try {
          (win as unknown as { print: () => void }).print = () => {
            (window.top as unknown as { __prints: number }).__prints += 1;
          };
        } catch {
          /* cross-origin */
        }
      };
      hook(window);
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of Array.from(m.addedNodes))
            if (n instanceof HTMLIFrameElement)
              n.addEventListener('load', () => n.contentWindow && hook(n.contentWindow));
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    // 1) Flip the REAL switch OFF in Settings → Hardware.
    await page.goto('/settings?section=hardware');
    const sw = page.getByRole('switch', { name: /silent printing/i });
    await expect(sw).toHaveAttribute('aria-checked', 'true'); // default ON
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => localStorage.getItem('usav.silentPrint'))).toBe('0');

    // 2) Print a carton — with silent OFF it must use the dialog (window.print),
    //    NOT the paired raw printer.
    await page.goto(`/receiving?recvId=${hit.receiving_id}&lineId=${hit.id}`);
    await expect(page.getByRole('button', { name: /Print\s*·?\s*receive/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: /Print only.*(scanned|receive)/i }).first().hover();
    await page.getByRole('menuitem', { name: /^Print only$/i }).first().click();

    const counts = () =>
      page.evaluate(() => ({
        serial: (window as unknown as { __serialBytes: number }).__serialBytes,
        prints: (window as unknown as { __prints: number }).__prints,
      }));
    await expect.poll(async () => (await counts()).prints, { timeout: 8000 }).toBeGreaterThan(0);
    expect(
      (await counts()).serial,
      'with silent OFF the label must NOT go to the raw printer',
    ).toBe(0);
  });

  // The toggle must GATE the raw silent path: ON → raw bytes go to the paired
  // (here faked) serial printer, no dialog; OFF → raw is skipped and the label
  // falls to window.print() (the dialog path). Uses a fake navigator.serial so
  // no real hardware is needed.
  test('OFF skips the raw path (dialog); ON uses the raw printer', async ({ page, request }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop unbox workspace only');

    // Resolve a real carton with a PO so the label has a scanValue.
    const res = await request.get('/api/receiving-lines?view=active&limit=60');
    expect(res.ok()).toBeTruthy();
    const lines = (await res.json())?.receiving_lines ?? [];
    const hit = lines.find(
      (l: { receiving_id?: number; zoho_purchaseorder_number?: string }) =>
        l.receiving_id && (l.zoho_purchaseorder_number || '').trim(),
    );
    test.skip(!hit, 'no received carton with a PO available');

    await page.addInitScript(() => {
      // Fake a paired serial LABEL printer + a fake navigator.serial that just
      // records bytes written, so printRawToProfile "succeeds" with no device.
      localStorage.setItem(
        'usav.printerProfiles',
        JSON.stringify({
          version: 2,
          profiles: [
            {
              id: 'fake-serial',
              name: 'Fake serial',
              role: 'label',
              kind: 'serial',
              vendorId: 0x1234,
              productId: 0x5678,
              serialNumber: null,
              language: 'escpos',
              paperSizeId: '2x1',
              baudRate: 9600,
              copies: 1,
            },
          ],
          routing: { label: 'fake-serial' },
        }),
      );
      const w = window as unknown as { __serialBytes: number; __prints: number };
      w.__serialBytes = 0;
      w.__prints = 0;
      const fakePort = {
        getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
        open: async () => {},
        close: async () => {},
        writable: {
          getWriter: () => ({
            write: async (d: Uint8Array) => {
              w.__serialBytes += d.byteLength ?? d.length ?? 0;
            },
            releaseLock: () => {},
          }),
        },
      };
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: { getPorts: async () => [fakePort], requestPort: async () => fakePort },
      });
      // Count window.print() in the page + any injected iframe (dialog path).
      const hook = (win: Window) => {
        try {
          (win as unknown as { print: () => void }).print = () => {
            (window.top as unknown as { __prints: number }).__prints += 1;
          };
        } catch {
          /* cross-origin */
        }
      };
      hook(window);
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of Array.from(m.addedNodes))
            if (n instanceof HTMLIFrameElement)
              n.addEventListener('load', () => n.contentWindow && hook(n.contentWindow));
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    await page.goto(`/receiving?recvId=${hit.receiving_id}&lineId=${hit.id}`);
    await expect(page.getByRole('button', { name: /Print\s*·?\s*receive/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    const openMenuAndPrintOnly = async () => {
      await page.getByRole('button', { name: /Print only.*(scanned|receive)/i }).first().hover();
      await page.getByRole('menuitem', { name: /^Print only$/i }).first().click();
    };
    const counts = () =>
      page.evaluate(() => ({
        serial: (window as unknown as { __serialBytes: number }).__serialBytes,
        prints: (window as unknown as { __prints: number }).__prints,
      }));

    // --- Silent OFF → dialog path (window.print), no raw bytes ---
    await page.evaluate(() => localStorage.setItem('usav.silentPrint', '0'));
    await openMenuAndPrintOnly();
    await expect.poll(async () => (await counts()).prints, { timeout: 8000 }).toBeGreaterThan(0);
    expect((await counts()).serial, 'OFF must not write raw bytes').toBe(0);

    // --- Silent ON → raw bytes to the (fake) serial printer, no new dialog ---
    await page.evaluate(() => {
      localStorage.setItem('usav.silentPrint', '1');
      (window as unknown as { __prints: number; __serialBytes: number }).__prints = 0;
      (window as unknown as { __serialBytes: number }).__serialBytes = 0;
    });
    await openMenuAndPrintOnly();
    await expect.poll(async () => (await counts()).serial, { timeout: 8000 }).toBeGreaterThan(0);
    expect((await counts()).prints, 'ON must not fall to the print dialog').toBe(0);
  });
});

/**
 * Silent-print GRACEFUL FALLBACK + serial robustness.
 *
 * When silent printing is ON but the raw send fails (driver-owned USB, a dead
 * COM port, no paired printer), the label must STILL print via the iframe /
 * window.print() fallback — and WITHOUT a "failed" toast. window.print() is
 * fire-and-forget (silent under --kiosk-printing, else the dialog), so the
 * label may well come out and a failure toast would be a false alarm. Explicit
 * diagnostics live in the Settings → Hardware "Test" button. These fake the
 * WebUSB / Web Serial layer to drive each failure, plus the "port already
 * open" recovery.
 */

// Standalone init (no outer refs) — hooks window.print() across the page and
// any injected iframe, and exposes a raw-serial byte counter. Stacked as its
// own addInitScript before each test's fake-device script.
function installPrintHook() {
  const w = window as unknown as { __prints: number; __serialBytes: number };
  w.__prints = 0;
  w.__serialBytes = 0;
  const hook = (win: Window) => {
    try {
      (win as unknown as { print: () => void }).print = () => {
        (window.top as unknown as { __prints: number }).__prints += 1;
      };
    } catch {
      /* cross-origin */
    }
  };
  hook(window);
  new MutationObserver((muts) => {
    for (const m of muts)
      for (const n of Array.from(m.addedNodes))
        if (n instanceof HTMLIFrameElement)
          n.addEventListener('load', () => n.contentWindow && hook(n.contentWindow));
  }).observe(document.documentElement, { childList: true, subtree: true });
}

test.describe('Silent print graceful fallback', () => {
  async function resolveCarton(
    request: import('@playwright/test').APIRequestContext,
  ): Promise<{ recvId: number; lineId: number } | null> {
    const res = await request.get('/api/receiving-lines?view=active&limit=60');
    if (!res.ok()) return null;
    const lines = (await res.json())?.receiving_lines ?? [];
    const hit = lines.find(
      (l: { receiving_id?: number; zoho_purchaseorder_number?: string }) =>
        l.receiving_id && (l.zoho_purchaseorder_number || '').trim(),
    );
    return hit ? { recvId: hit.receiving_id, lineId: hit.id } : null;
  }

  async function openCartonAndPrintOnly(
    page: import('@playwright/test').Page,
    recvId: number,
    lineId: number,
  ) {
    await page.goto(`/receiving?recvId=${recvId}&lineId=${lineId}`);
    await expect(page.getByRole('button', { name: /Print\s*·?\s*receive/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: /Print only.*(scanned|receive)/i }).first().hover();
    await page.getByRole('menuitem', { name: /^Print only$/i }).first().click();
  }

  const counts = (page: import('@playwright/test').Page) =>
    page.evaluate(() => ({
      prints: (window as unknown as { __prints: number }).__prints,
      serial: (window as unknown as { __serialBytes: number }).__serialBytes,
    }));

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop unbox workspace only');
    await page.addInitScript(installPrintHook);
  });

  test('USB "Access denied" falls back to window.print(), no error toast', async ({ page, request }) => {
    const c = await resolveCarton(request);
    test.skip(!c, 'no received carton with a PO available');

    await page.addInitScript(() => {
      localStorage.setItem(
        'usav.printerProfiles',
        JSON.stringify({
          version: 2,
          profiles: [
            { id: 'usb1', name: 'USB label', role: 'label', kind: 'usb', vendorId: 0x9, productId: 0x9, serialNumber: null, language: 'tspl', paperSizeId: '2x1', copies: 1 },
          ],
          routing: { label: 'usb1' },
        }),
      );
      const fakeDevice = {
        vendorId: 0x9, productId: 0x9, serialNumber: null, opened: false, configuration: null,
        open: async () => { throw new Error("Failed to execute 'open' on 'USBDevice': Access denied."); },
        close: async () => {}, selectConfiguration: async () => {}, claimInterface: async () => {}, transferOut: async () => ({}),
      };
      Object.defineProperty(navigator, 'usb', {
        configurable: true,
        value: { getDevices: async () => [fakeDevice], requestDevice: async () => fakeDevice },
      });
    });

    await openCartonAndPrintOnly(page, c!.recvId, c!.lineId);
    await expect.poll(async () => (await counts(page)).prints, { timeout: 8000 }).toBeGreaterThan(0);
    await expect(page.getByText(/Silent print failed/i)).toHaveCount(0);
  });

  test('dead COM port falls back to window.print(), no error toast', async ({ page, request }) => {
    const c = await resolveCarton(request);
    test.skip(!c, 'no received carton with a PO available');

    await page.addInitScript(() => {
      localStorage.setItem(
        'usav.printerProfiles',
        JSON.stringify({
          version: 2,
          profiles: [
            { id: 'ser1', name: 'COM label', role: 'label', kind: 'serial', vendorId: 0, productId: 0, serialNumber: null, language: 'escpos', paperSizeId: '2x1', baudRate: 9600, copies: 1 },
          ],
          routing: { label: 'ser1' },
        }),
      );
      const fakePort = {
        getInfo: () => ({}),
        open: async () => { throw new Error('Failed to open serial port.'); },
        close: async () => {},
        writable: null,
      };
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: { getPorts: async () => [fakePort], requestPort: async () => fakePort },
      });
    });

    await openCartonAndPrintOnly(page, c!.recvId, c!.lineId);
    await expect.poll(async () => (await counts(page)).prints, { timeout: 8000 }).toBeGreaterThan(0);
    await expect(page.getByText(/Silent print failed/i)).toHaveCount(0);
  });

  test('no paired label printer falls back to window.print(), no error toast', async ({ page, request }) => {
    const c = await resolveCarton(request);
    test.skip(!c, 'no received carton with a PO available');

    await page.addInitScript(() => {
      localStorage.setItem('usav.printerProfiles', JSON.stringify({ version: 2, profiles: [], routing: {} }));
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: { getPorts: async () => [], requestPort: async () => ({}) },
      });
    });

    await openCartonAndPrintOnly(page, c!.recvId, c!.lineId);
    await expect.poll(async () => (await counts(page)).prints, { timeout: 8000 }).toBeGreaterThan(0);
    await expect(page.getByText(/Silent print failed/i)).toHaveCount(0);
  });

  test('serial "already open" recovers and prints raw (no fallback)', async ({ page, request }) => {
    const c = await resolveCarton(request);
    test.skip(!c, 'no received carton with a PO available');

    await page.addInitScript(() => {
      localStorage.setItem(
        'usav.printerProfiles',
        JSON.stringify({
          version: 2,
          profiles: [
            { id: 'ser2', name: 'COM label', role: 'label', kind: 'serial', vendorId: 0, productId: 0, serialNumber: null, language: 'escpos', paperSizeId: '2x1', baudRate: 9600, copies: 1 },
          ],
          routing: { label: 'ser2' },
        }),
      );
      const fakePort = {
        getInfo: () => ({}),
        open: async () => { throw new Error('The port is already open.'); },
        close: async () => {},
        writable: {
          getWriter: () => ({
            write: async (d: Uint8Array) => {
              (window as unknown as { __serialBytes: number }).__serialBytes += d.byteLength ?? 0;
            },
            releaseLock: () => {},
          }),
        },
      };
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: { getPorts: async () => [fakePort], requestPort: async () => fakePort },
      });
    });

    await openCartonAndPrintOnly(page, c!.recvId, c!.lineId);
    // Raw bytes were written despite the "already open" throw …
    await expect.poll(async () => (await counts(page)).serial, { timeout: 8000 }).toBeGreaterThan(0);
    // … so it did NOT fall back to window.print().
    expect((await counts(page)).prints, 'recovered raw print should not fall back').toBe(0);
  });
});

test.describe('Unbox Print button wiring', () => {
  // Uses the saved admin session (global-setup, pinless). Resolves a real
  // carton (a receiving line WITH a receiving_id + a PO so the label has a
  // scanValue) from the API, then deep-links straight into the unbox workspace.
  test('clicking "Print only" on a receiving line fires a silent label print', async ({
    page,
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop unbox workspace only');

    // Find a received line with a carton + PO. Env override wins when set.
    let recvId = Number(process.env.PW_PRINT_RECV_ID) || 0;
    let lineId = Number(process.env.PW_PRINT_LINE_ID) || 0;
    if (!recvId || !lineId) {
      const res = await request.get('/api/receiving-lines?view=active&limit=60');
      expect(res.ok(), `receiving-lines load failed (${res.status()})`).toBeTruthy();
      const lines = (await res.json())?.receiving_lines ?? [];
      const hit = lines.find(
        (l: { receiving_id?: number; zoho_purchaseorder_number?: string }) =>
          l.receiving_id && (l.zoho_purchaseorder_number || '').trim(),
      );
      test.skip(!hit, 'no received carton with a PO available in this environment');
      recvId = hit.receiving_id;
      lineId = hit.id;
    }

    // Count every window.print() in the top page AND in any iframe the print
    // fallback injects (printHtmlInIframe). The label HTML's embedded script
    // calls window.print() inside its own iframe document.
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      const bump = () => {
        (window.top as unknown as { __prints: number }).__prints += 1;
      };
      const hook = (w: Window) => {
        try {
          (w as unknown as { print: () => void }).print = bump;
        } catch {
          /* cross-origin — ignore */
        }
      };
      hook(window);
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of Array.from(m.addedNodes))
            if (n instanceof HTMLIFrameElement)
              n.addEventListener('load', () => n.contentWindow && hook(n.contentWindow));
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    // Safety net: a "Print only" must NOT hit the Zoho receive endpoints.
    const receiveCall = page.waitForRequest(
      (r) => /\/api\/(receiving\/mark-received|zoho\/purchase-orders\/receive)/.test(r.url()),
      { timeout: 4000 },
    ).catch(() => null);

    await page.goto(`/receiving?recvId=${recvId}&lineId=${lineId}`);

    // The deep link selects the row and mounts LineEditPanel in the right pane.
    const printReceive = page.getByRole('button', { name: /Print\s*·?\s*receive/i }).first();
    await expect(printReceive, 'unbox Print·receive button did not mount').toBeVisible({
      timeout: 20_000,
    });

    // Open the split menu (hover the chevron) and click "Print only" — the path
    // that runs runPrintLabel() with no receive side effect.
    const splitTrigger = page.getByRole('button', {
      name: /Print only.*(scanned|receive)/i,
    });
    await splitTrigger.first().hover();
    const printOnly = page.getByRole('menuitem', { name: /^Print only$/i }).first();
    await printOnly.click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints), {
        timeout: 8000,
        message: 'Print only did not trigger a window.print()',
      })
      .toBeGreaterThan(0);

    expect(await receiveCall, '"Print only" must not call a receive endpoint').toBeNull();
  });
});
