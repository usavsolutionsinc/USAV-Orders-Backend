/**
 * Pre-paint boot splash (the white-flash bridge).
 *
 * A fresh sign-in lands on the dashboard via a HARD navigation
 * (window.location.assign). The dashboard's SSR HTML is NOT the splash — the app
 * shell (ResponsiveLayout) gates all children behind a client `mounted` flag, so
 * the document's first paint is a blank white div, and React's <BootGate> splash
 * only appears a few hundred ms later after hydration. Coming straight from the
 * sign-in-side splash, that blank gap reads as the "Loading your workspace"
 * screen flickering off and back on.
 *
 * This script runs synchronously in <head> (like THEME_BOOT_SCRIPT) on every
 * document load. When the one-shot boot flag is set it paints a static splash —
 * visually identical to <BootSplash> — into <html> immediately, BEFORE first
 * paint, bridging the gap. <BootGate> removes it (#__boot_splash_pre) as soon as
 * its own React splash is mounted on top, so the handoff is seamless. A 10s
 * self-removal is a safety net in case no BootGate ever claims it.
 *
 * The flag key and the element id below are duplicated by hand:
 *   - key  'usav:boot-splash'   must match BOOT_FLAG_KEY in `boot-flag.ts`
 *   - id   '__boot_splash_pre'  must match the removal in `components/boot/BootGate.tsx`
 *   - z-index 2000              must match `tokens/z-index.ts` (splash)
 * Keep them in sync.
 */
export const BOOT_SPLASH_PRE_ID = '__boot_splash_pre';

export const BOOT_SPLASH_SCRIPT = `(function(){
  try {
    if (sessionStorage.getItem('usav:boot-splash') !== '1') return;
    var ID = '__boot_splash_pre';
    if (document.getElementById(ID)) return;
    var style = document.createElement('style');
    style.textContent = '@keyframes __bsSweep{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}@keyframes __bsRing{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.12);opacity:.15}}';
    (document.head || document.documentElement).appendChild(style);
    var root = document.createElement('div');
    root.id = ID;
    root.setAttribute('aria-hidden','true');
    root.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#fff;display:flex;align-items:center;justify-content:center';
    root.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;gap:24px">'
      + '<div style="position:relative;display:flex;height:64px;width:64px;align-items:center;justify-content:center">'
      +   '<span style="position:absolute;inset:0;border-radius:16px;border:2px solid #e5e7eb;animation:__bsRing 1.8s ease-in-out infinite"></span>'
      +   '<img src="/favicon.png" width="44" height="44" style="border-radius:12px" alt=""/>'
      + '</div>'
      + '<div style="height:4px;width:160px;overflow:hidden;border-radius:9999px;background:#f3f4f6">'
      +   '<div style="height:100%;width:33%;border-radius:9999px;background:#0f172a;animation:__bsSweep 1.1s ease-in-out infinite"></div>'
      + '</div>'
      + '<p style="margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af">Loading your workspace…</p>'
      + '</div>';
    (document.body || document.documentElement).appendChild(root);
    setTimeout(function(){ var el = document.getElementById(ID); if (el) el.remove(); }, 10000);
  } catch (e) {}
})();`;
