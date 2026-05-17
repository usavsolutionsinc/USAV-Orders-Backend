'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Script from 'next/script';

/**
 * ArchitectureTab — main pane for the codebase-visualizer.
 *
 * Selection lives in the URL (`?diagram=<key>`) and is owned by
 * `ArchitectureSidebarPanel`. This component just renders whichever
 * diagram is currently selected.
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

const CLAUDE_LIGHT = {
  bg: '#faf9f5',
  surface: '#f5f4ee',
  surfaceAlt: '#efece2',
  border: '#e8e6dc',
  borderStrong: '#d8d2c2',
  text: '#3d3929',
  textMuted: '#8b8473',
  accent: '#cc785c',
  accentSoft: '#f0dcd2',
};

const CLAUDE_DARK = {
  bg: '#1f1d1a',
  surface: '#27241f',
  surfaceAlt: '#2e2a24',
  border: '#3a352d',
  borderStrong: '#4a443a',
  text: '#ece9e2',
  textMuted: '#9c9485',
  accent: '#e08a6e',
  accentSoft: '#3d2a23',
};

const MERMAID_LIGHT_VARS = {
  fontFamily: 'ui-sans-serif, -apple-system, system-ui, sans-serif',
  fontSize: '13px',
  background: CLAUDE_LIGHT.bg,
  primaryColor: CLAUDE_LIGHT.bg,
  primaryTextColor: CLAUDE_LIGHT.text,
  primaryBorderColor: '#c9b89a',
  lineColor: '#a39e8e',
  secondaryColor: '#f5efe4',
  tertiaryColor: CLAUDE_LIGHT.surface,
  clusterBkg: CLAUDE_LIGHT.bg,
  clusterBorder: CLAUDE_LIGHT.borderStrong,
  edgeLabelBackground: CLAUDE_LIGHT.bg,
  titleColor: CLAUDE_LIGHT.text,
};

const MERMAID_DARK_VARS = {
  fontFamily: 'ui-sans-serif, -apple-system, system-ui, sans-serif',
  fontSize: '13px',
  background: CLAUDE_DARK.bg,
  primaryColor: CLAUDE_DARK.surface,
  primaryTextColor: CLAUDE_DARK.text,
  primaryBorderColor: '#5a5142',
  lineColor: '#6b6354',
  secondaryColor: CLAUDE_DARK.surfaceAlt,
  tertiaryColor: CLAUDE_DARK.surface,
  clusterBkg: CLAUDE_DARK.bg,
  clusterBorder: CLAUDE_DARK.borderStrong,
  edgeLabelBackground: CLAUDE_DARK.surface,
  titleColor: CLAUDE_DARK.text,
};

export function ArchitectureTab() {
  const searchParams = useSearchParams();
  const activeKey = searchParams.get('diagram') ?? '';

  const [data, setData] = useState<ArchitectureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mermaidReady, setMermaidReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const targetRef = useRef<HTMLDivElement>(null);

  const palette = theme === 'dark' ? CLAUDE_DARK : CLAUDE_LIGHT;

  const loadData = useCallback(async () => {
    setLoading(true);
    setRenderError(null);
    try {
      const res = await fetch('/api/architecture', { cache: 'no-store' });
      const json = (await res.json()) as ArchitectureResponse;
      setData(json);
    } catch (err) {
      setData({ ok: false, reason: 'fetch_failed', hint: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handler = () => void loadData();
    window.addEventListener('admin-architecture-refresh', handler);
    return () => window.removeEventListener('admin-architecture-refresh', handler);
  }, [loadData]);

  useEffect(() => {
    if (!mermaidReady || !window.mermaid) return;
    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: theme === 'dark' ? MERMAID_DARK_VARS : MERMAID_LIGHT_VARS,
      securityLevel: 'loose',
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
      mindmap: { useMaxWidth: false },
      sequence: { useMaxWidth: false, actorBkg: palette.surface, actorBorder: palette.borderStrong },
    });
  }, [mermaidReady, theme, palette.surface, palette.borderStrong]);

  useEffect(() => {
    if (!mermaidReady || !data?.ok || !activeKey || !targetRef.current) return;
    const diagram = data.diagrams[activeKey];
    if (!diagram) return;

    const node = targetRef.current;
    node.innerHTML = `<div style="color:${palette.textMuted};font-size:12px;padding:8px">Rendering…</div>`;
    setRenderError(null);

    const renderId = `arch-${activeKey}-${Date.now()}`;
    window.mermaid!
      .render(renderId, diagram.mermaid)
      .then(({ svg, bindFunctions }) => {
        node.innerHTML = svg;
        if (bindFunctions) bindFunctions(node);

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
  }, [mermaidReady, data, activeKey, theme, palette.textMuted]);

  const activeDiagram = data?.ok && activeKey ? data.diagrams[activeKey] : null;

  return (
    <>
      <Script src={MERMAID_CDN} strategy="afterInteractive" onLoad={() => setMermaidReady(true)} />
      <div
        className="flex h-full min-h-0 w-full flex-col"
        style={{ background: palette.bg, color: palette.text }}
      >
        <header
          className="flex items-center justify-between gap-3 px-6 py-4"
          style={{ borderBottom: `1px solid ${palette.border}`, background: palette.bg }}
        >
          <div className="min-w-0">
            <h2
              className="text-base font-semibold tracking-tight"
              style={{ color: palette.text, fontFamily: 'ui-serif, Georgia, "Times New Roman", serif' }}
            >
              {activeDiagram?.title ?? 'Architecture'}
            </h2>
            {activeDiagram?.description ? (
              <p className="mt-0.5 text-[12px]" style={{ color: palette.textMuted }}>
                {activeDiagram.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PillButton
              palette={palette}
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title="Toggle theme"
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </PillButton>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto" style={{ background: palette.bg }}>
          {loading && (
            <div className="p-8 text-sm" style={{ color: palette.textMuted }}>
              Loading diagrams…
            </div>
          )}

          {data && !data.ok && (
            <div
              className="m-6 rounded-lg p-5 text-sm"
              style={{
                background: palette.accentSoft,
                border: `1px solid ${palette.borderStrong}`,
                color: palette.text,
              }}
            >
              <p className="font-semibold">Diagrams haven&apos;t been generated yet.</p>
              <p className="mt-2 text-[13px]" style={{ color: palette.textMuted }}>
                {data.hint || data.reason}
              </p>
              <pre
                className="mt-3 overflow-x-auto rounded-md p-3 text-[12px]"
                style={{ background: palette.surface, color: palette.text }}
              >
                python3 ~/.hermes-usav/skills/software-development/codebase-visualizer/scripts/generate.py
              </pre>
              <p className="mt-2 text-[12px]" style={{ color: palette.textMuted }}>
                The post-commit git hook runs this automatically after every commit
                that touches source files.
              </p>
            </div>
          )}

          {data?.ok && !activeDiagram && (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                <p
                  className="text-[13px] font-bold"
                  style={{ color: palette.text }}
                >
                  Pick a diagram
                </p>
                <p className="text-[11px]" style={{ color: palette.textMuted }}>
                  Select a diagram from the left to view it.
                </p>
              </div>
            </div>
          )}

          {data?.ok && activeDiagram && (
            <div className="p-6">
              {renderError && (
                <div
                  className="mb-4 rounded-md p-3 text-xs"
                  style={{
                    background: '#fcecea',
                    border: '1px solid #e8b8b0',
                    color: '#7a2820',
                  }}
                >
                  <p className="font-semibold">Render error</p>
                  <pre className="mt-1 whitespace-pre-wrap text-[11px]">{renderError}</pre>
                </div>
              )}
              <div
                className="rounded-lg p-6"
                style={{
                  background: palette.bg,
                  border: `1px solid ${palette.border}`,
                  boxShadow:
                    theme === 'dark'
                      ? '0 1px 2px rgba(0,0,0,0.4)'
                      : '0 1px 2px rgba(61,57,41,0.05)',
                  overflow: 'auto',
                }}
              >
                <div ref={targetRef} className="mermaid-target" />
              </div>
              <p className="mt-3 text-[11px]" style={{ color: palette.textMuted }}>
                Click nodes with file paths to open them in VS Code.
              </p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

type PaletteShape = typeof CLAUDE_LIGHT;

function PillButton({
  palette,
  onClick,
  disabled,
  accent,
  title,
  children,
}: {
  palette: PaletteShape;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
      style={{
        background: accent ? palette.accent : palette.bg,
        color: accent ? '#ffffff' : palette.text,
        border: `1px solid ${accent ? palette.accent : palette.borderStrong}`,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = accent ? '#b3674e' : palette.surface;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = accent ? palette.accent : palette.bg;
      }}
    >
      {children}
    </button>
  );
}
