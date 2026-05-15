'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';

/**
 * ArchitectureTab — live renderer for the codebase-visualizer diagrams.
 *
 * Fetches /api/architecture (which reads docs/architecture/ from disk on the
 * server) and renders each Mermaid diagram in a tabbed view. Mirrors the
 * standalone docs/architecture/index.html viewer but embedded in the admin
 * UI so it tracks the same content the generator produces.
 *
 * The post-commit git hook regenerates the source files on every commit, so
 * this tab is always live — just refetch after a commit and you'll see the
 * new graphs. The Refresh button does exactly that (no server-side trigger
 * because the browser can't shell out to run generate.py).
 *
 * Mermaid is loaded once via next/script from the jsdelivr CDN and exposed
 * on window as `mermaid`. We re-initialize whenever the theme flips so dark
 * mode in the admin actually changes diagram colors. Render errors are
 * surfaced inline rather than swallowed — bad Mermaid syntax means the
 * generator is buggy, and we want to know.
 */

type DiagramPayload = { title: string; description: string; mermaid: string };
type ArchitectureResponse =
  | {
      ok: true;
      manifest: {
        generated_at: string;
        project_name: string;
        files_scanned: number;
        git_head: string;
      };
      diagrams: Record<string, DiagramPayload>;
    }
  | { ok: false; reason: string; hint?: string };

declare global {
  interface Window {
    mermaid?: {
      initialize: (cfg: Record<string, unknown>) => void;
      render: (id: string, src: string) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
    };
  }
}

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';

export function ArchitectureTab() {
  const [data, setData] = useState<ArchitectureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string>('');
  const [mermaidReady, setMermaidReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const targetRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setRenderError(null);
    try {
      const res = await fetch('/api/architecture', { cache: 'no-store' });
      const json = (await res.json()) as ArchitectureResponse;
      setData(json);
      if (json.ok) {
        const firstKey = Object.keys(json.diagrams)[0] || '';
        setActiveKey((prev) => (prev && json.diagrams[prev] ? prev : firstKey));
      }
    } catch (err) {
      setData({ ok: false, reason: 'fetch_failed', hint: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // (Re)initialize Mermaid whenever the script becomes available or the theme
  // changes. Mermaid keeps its config in a singleton, so calling initialize
  // again is the supported way to flip themes.
  useEffect(() => {
    if (!mermaidReady || !window.mermaid) return;
    window.mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
      flowchart: { useMaxWidth: false, htmlLabels: true },
      mindmap: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
  }, [mermaidReady, theme]);

  // Render the active diagram any time the diagram, theme, or Mermaid-ready
  // flag changes. Each render uses a unique id so Mermaid doesn't dedupe
  // against a previous SVG still in the DOM.
  useEffect(() => {
    if (!mermaidReady || !data?.ok || !activeKey || !targetRef.current) return;
    const diagram = data.diagrams[activeKey];
    if (!diagram) return;

    const node = targetRef.current;
    node.innerHTML = '<div style="color:#888;font-size:12px">Rendering…</div>';
    setRenderError(null);

    const renderId = `arch-${activeKey}-${Date.now()}`;
    window.mermaid!
      .render(renderId, diagram.mermaid)
      .then(({ svg, bindFunctions }) => {
        node.innerHTML = svg;
        if (bindFunctions) bindFunctions(node);

        // Fit-to-width for huge diagrams so the user doesn't see a tiny
        // corner of a 6000px-wide graph. Same logic as the standalone HTML.
        const svgEl = node.querySelector('svg');
        if (svgEl) {
          const intrinsicW = svgEl.viewBox.baseVal.width || svgEl.getBoundingClientRect().width || 0;
          const availW = node.clientWidth - 32;
          if (intrinsicW > availW && availW > 0) {
            svgEl.setAttribute('width', `${availW}px`);
            svgEl.removeAttribute('height');
            (svgEl as SVGSVGElement).style.height = 'auto';
          }
        }

        // Wire click handlers (Mermaid emits <a xlink:href=...>) to open
        // the file path in VS Code / Cursor via the protocol handler.
        node.querySelectorAll('a').forEach((a) => {
          const href = a.getAttribute('xlink:href') || a.getAttribute('href');
          if (!href) return;
          a.addEventListener('click', (e) => {
            e.preventDefault();
            window.open(`vscode://file/${encodeURIComponent(href)}`);
          });
        });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setRenderError(msg);
        node.innerHTML = '';
      });
  }, [mermaidReady, data, activeKey, theme]);

  const diagramList = useMemo(() => {
    if (!data?.ok) return [];
    return Object.entries(data.diagrams).map(([key, d]) => ({ key, title: d.title }));
  }, [data]);

  const activeDiagram = data?.ok && activeKey ? data.diagrams[activeKey] : null;

  return (
    <>
      <Script
        src={MERMAID_CDN}
        strategy="afterInteractive"
        onLoad={() => setMermaidReady(true)}
      />
      <div className="flex h-full w-full flex-col bg-gray-50">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900">
              Architecture · Live Diagrams
            </h2>
            {data?.ok && (
              <p className="text-[10px] text-gray-500">
                {data.manifest.project_name} · {data.manifest.files_scanned} files ·
                {' '}generated {data.manifest.generated_at} · git {data.manifest.git_head.slice(0, 7)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-700 hover:border-gray-400"
              title="Toggle Mermaid theme"
            >
              🌓 {theme}
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              title="Re-fetch the latest generated diagrams from disk"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Body: sidebar tabs + diagram pane */}
        <div className="flex min-h-0 flex-1">
          <aside className="w-44 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
            <nav className="p-2">
              {diagramList.map(({ key, title }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveKey(key)}
                  className={`mb-1 block w-full rounded px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                    activeKey === key
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {title}
                </button>
              ))}
              {diagramList.length === 0 && !loading && (
                <p className="px-2 py-2 text-[10px] text-gray-500">
                  No diagrams yet.
                </p>
              )}
            </nav>
          </aside>

          <main className="min-w-0 flex-1 overflow-auto">
            {loading && (
              <div className="p-6 text-sm text-gray-500">Loading diagrams…</div>
            )}

            {data && !data.ok && (
              <div className="m-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-bold">Diagrams haven&apos;t been generated yet.</p>
                <p className="mt-2">{data.hint || data.reason}</p>
                <pre className="mt-3 overflow-x-auto rounded bg-amber-100 p-2 text-[11px]">
                  python3 ~/.hermes-usav/skills/software-development/codebase-visualizer/scripts/generate.py
                </pre>
                <p className="mt-2 text-[11px]">
                  The post-commit git hook also runs this automatically after every commit
                  that touches source files.
                </p>
              </div>
            )}

            {data?.ok && activeDiagram && (
              <div className="p-4">
                <div className="mb-2">
                  <h3 className="text-sm font-bold text-gray-900">{activeDiagram.title}</h3>
                  <p className="text-[11px] text-gray-500">{activeDiagram.description}</p>
                </div>
                {renderError && (
                  <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                    <p className="font-bold">Render error</p>
                    <pre className="mt-1 whitespace-pre-wrap text-[11px]">{renderError}</pre>
                  </div>
                )}
                <div
                  className={`rounded border p-4 ${
                    theme === 'dark'
                      ? 'border-gray-700 bg-gray-900'
                      : 'border-gray-200 bg-white'
                  }`}
                  style={{ overflow: 'auto' }}
                >
                  <div ref={targetRef} className="mermaid-target" />
                </div>
                <p className="mt-2 text-[10px] text-gray-400">
                  Tip: click nodes with file paths to open them in VS Code.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
