/**
 * Browser silent-print fallback — renders label/report HTML in a hidden iframe
 * and lets the page's own `window.print()` drive the job.
 *
 * Why an iframe (not `window.open` + popup):
 *   - No popup window flashes on screen, and the popup blocker can't intercept
 *     it (a hidden same-document iframe needs no user-gesture popup grant).
 *   - The print originates from the iframe's own document, so `window.print()`
 *     prints exactly that label.
 *
 * What makes it SILENT:
 *   Under Chrome/Edge launched with `--kiosk-printing`, any `window.print()`
 *   call prints straight to the *default* printer with NO dialog. Without that
 *   flag the normal print dialog appears (browsers give web pages no other way
 *   to reach a driver-owned OS printer). So for dialog-free receiving labels in
 *   a browser tab: set the label printer as the default printer and start the
 *   browser with `--kiosk-printing`. The desktop (Electron) shell
 *   needs none of this — it prints silently via `webContents.print` upstream of
 *   this fallback (see {@link printHtmlSilent}).
 *
 * The label HTML embeds its own `window.onload -> window.print()` (so the legacy
 * popup path still drives itself); inside the iframe that same script runs in the
 * frame's context and prints the frame. We only own the iframe lifecycle here.
 */

export interface IframePrintOptions {
  /** Safety-net delay (ms) before the hidden iframe is torn down. Default 60s. */
  removeAfterMs?: number;
  /** Log prefix used if the document can't be mounted. */
  name?: string;
}

/**
 * Print fully-formed HTML by mounting it in a hidden iframe. Returns true once
 * the iframe is attached (the print itself is driven by the embedded script /
 * the browser), false if the DOM isn't available.
 */
export function printHtmlInIframe(html: string, options: IframePrintOptions = {}): boolean {
  if (typeof document === 'undefined' || !document.body) return false;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = options.name ?? 'Print label';
  // Keep it in the layout (display:none can suppress printing in some engines)
  // but visually gone and zero-footprint.
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    try {
      iframe.remove();
    } catch {
      /* already detached */
    }
  };

  iframe.onload = () => {
    const cw = iframe.contentWindow;
    // Tear down shortly after the job leaves (kiosk: instant; dialog: on close).
    try {
      cw?.addEventListener('afterprint', () => window.setTimeout(cleanup, 250), { once: true });
    } catch {
      /* cross-frame guard — fall back to the timer below */
    }
    window.setTimeout(cleanup, options.removeAfterMs ?? 60_000);
  };

  document.body.appendChild(iframe);
  // srcdoc runs the embedded <script> (window.onload -> window.print()) in the
  // iframe's own document, which is what gets printed.
  iframe.srcdoc = html;
  return true;
}
