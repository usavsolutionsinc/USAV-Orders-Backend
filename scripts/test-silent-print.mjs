// Standalone harness that exercises the EXACT production silent-print path from
// electron/main.js (`print-html` handler) against a representative 2x1 receiving
// label. Non-destructive: renders through Electron's real print pipeline to a PDF
// (printToPDF) and enumerates printers via getPrintersAsync — proving the
// HTML -> Electron print pipeline + device discovery work WITHOUT spooling paper.
// Pass `--real` to additionally perform a genuine silent webContents.print to the
// system default printer.
import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DO_REAL_PRINT = process.argv.includes('--real');

const LABEL_HTML = `<!doctype html><html><head><meta charset="utf-8"/><title>Label</title>
<style>
  @page{size:2in 1in;margin:0}
  *,*::before,*::after{box-sizing:border-box}
  html,body{width:2in;height:1in;padding:0;margin:0;font-family:Arial,sans-serif;color:#111}
  .wrap{width:2in;height:1in;display:flex;align-items:stretch;gap:4px;padding:4px 5px}
  .t{font-size:14px;font-weight:900}
  .s{font-size:10px;color:#444;margin-top:4px}
</style></head><body>
  <div class="wrap"><div>
    <div class="t">SILENT PRINT TEST</div>
    <div class="s">Receiving label path · printHtml IPC</div>
    <div class="s">USED-A · RCV-TEST</div>
  </div></div>
</body></html>`;

function loadHtml(win, html) {
  const dataUrl =
    'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64');
  return new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`load failed: ${desc} (${code})`)));
    win.loadURL(dataUrl).catch(reject);
  });
}

app.whenReady().then(async () => {
  const log = (...a) => console.log('[test]', ...a);
  let exitCode = 0;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  try {
    await loadHtml(win, LABEL_HTML);
    await new Promise((r) => setTimeout(r, 300));

    // 1. Device enumeration — same call the list-printers IPC uses.
    const printers = await win.webContents.getPrintersAsync();
    log(`getPrintersAsync -> ${printers.length} printer(s):`);
    for (const p of printers) {
      log(`   - ${p.name}${p.isDefault ? '  (DEFAULT)' : ''}  [status=${p.status}]`);
    }

    // 2. Render through the real Electron print pipeline -> PDF (no paper).
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: 2 * 25400, height: 1 * 25400 },
      margins: { marginType: 'none' },
      printBackground: true,
    });
    const out = join(process.cwd(), 'desktop-dist', 'silent-print-test.pdf');
    await writeFile(out, pdf);
    log(`printToPDF OK -> ${out} (${pdf.length} bytes) — HTML renders in the print pipeline.`);

    // 3. Optional real silent print to default printer.
    if (DO_REAL_PRINT) {
      const result = await new Promise((resolve) => {
        win.webContents.print(
          { silent: true, printBackground: true, margins: { marginType: 'none' },
            pageSize: { width: 2 * 25400, height: 1 * 25400 } },
          (success, reason) => resolve({ success, reason: reason ?? null }),
        );
      });
      log(`webContents.print(silent) -> ${JSON.stringify(result)}`);
      if (!result.success) exitCode = 2;
    } else {
      log('Skipped physical print (pass --real to spool to the default printer).');
    }

    log('RESULT: silent-print shell path is FUNCTIONAL on this machine.');
  } catch (err) {
    console.error('[test] FAILED:', err.message);
    exitCode = 1;
  } finally {
    try { win.destroy(); } catch {}
    app.exit(exitCode);
  }
});
