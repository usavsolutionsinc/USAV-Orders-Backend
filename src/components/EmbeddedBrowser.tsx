'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

type WebviewElement = HTMLElement & {
  src: string;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
};

interface EmbeddedBrowserProps {
  /** Initial URL to load */
  url: string;
  /** Called whenever the webview navigates to a new URL */
  onNavigate?: (url: string) => void;
  className?: string;
}

/**
 * A full embedded browser panel powered by Electron's <webview> tag.
 *
 * The <webview> tag bypasses X-Frame-Options / CSP restrictions that prevent
 * normal <iframe> embeds (e.g. eBay, shipping portals, etc.).
 *
 * This component must only be rendered inside the Electron shell. In a
 * browser context it shows a fallback message instead.
 */
export default function EmbeddedBrowser({ url, onNavigate, className = '' }: EmbeddedBrowserProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [loading, setLoading] = useState(false);
  const [isElectronEnv, setIsElectronEnv] = useState(false);

  useEffect(() => {
    // Guard: webview tag is only available in Electron
    setIsElectronEnv(
      typeof window !== 'undefined' &&
        !!(window as Window & { desktopApp?: { isElectron?: boolean } }).desktopApp?.isElectron
    );
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onStartLoading = () => setLoading(true);
    const onStopLoading = () => setLoading(false);
    const onDidNavigate = (event: Event) => {
      const nextUrl = String((event as Event & { url?: string }).url || '').trim();
      if (!nextUrl) return;
      setCurrentUrl(nextUrl);
      onNavigate?.(nextUrl);
    };

    wv.addEventListener('did-start-loading', onStartLoading);
    wv.addEventListener('did-stop-loading', onStopLoading);
    wv.addEventListener('did-navigate', onDidNavigate);
    wv.addEventListener('did-navigate-in-page', onDidNavigate);

    return () => {
      wv.removeEventListener('did-start-loading', onStartLoading);
      wv.removeEventListener('did-stop-loading', onStopLoading);
      wv.removeEventListener('did-navigate', onDidNavigate);
      wv.removeEventListener('did-navigate-in-page', onDidNavigate);
    };
  }, [onNavigate]);

  // Sync external URL prop changes into the webview
  useEffect(() => {
    const wv = webviewRef.current;
    if (wv && url !== currentUrl) {
      wv.src = url;
      setCurrentUrl(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleAddressKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && webviewRef.current) {
        const target = currentUrl.startsWith('http') ? currentUrl : `https://${currentUrl}`;
        webviewRef.current.src = target;
      }
    },
    [currentUrl]
  );

  if (!isElectronEnv) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 bg-gray-900 rounded-lg">
        Embedded browser is only available in the desktop app.
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
        <button
          onClick={() => webviewRef.current?.goBack()}
          title="Back"
          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 text-sm font-mono"
        >
          ←
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          title="Forward"
          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 text-sm font-mono"
        >
          →
        </button>
        <button
          onClick={() => webviewRef.current?.reload()}
          title="Reload"
          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 text-sm"
        >
          ↺
        </button>

        <input
          value={currentUrl}
          onChange={(e) => setCurrentUrl(e.target.value)}
          onKeyDown={handleAddressKeyDown}
          placeholder="Enter URL…"
          className="flex-1 px-2 py-1 text-xs bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
          spellCheck={false}
        />

        {loading && (
          <span className="text-xs text-gray-500 animate-pulse pr-1">Loading…</span>
        )}
      </div>

      {/* Webview — bypasses X-Frame-Options */}
      <webview
        ref={webviewRef}
        src={url}
        style={{ flex: 1, width: '100%' }}
        allowpopups
      />
    </div>
  );
}
