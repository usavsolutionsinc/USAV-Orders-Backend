'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Copy } from '@/components/Icons';

/**
 * Fenced code block chrome for chat answers: a language label + copy button
 * over a light, horizontally-scrollable code surface. `children` are the
 * already-highlighted nodes produced by rehype-highlight (see MarkdownRenderer);
 * the raw text for copy is read from the rendered DOM.
 */
export default function CodeBlock({ language, children }: { language?: string; children: ReactNode }) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = codeRef.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border-soft bg-surface-card">
      <div className="flex items-center justify-between border-b border-border-soft bg-surface-canvas px-3 py-1.5">
        <span className="text-micro font-semibold uppercase tracking-wider text-text-soft">{language || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="ds-raw-button inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-semibold text-text-soft transition-colors hover:bg-surface-strong hover:text-text-default"
          aria-label="Copy code"
        >
          <Copy className="h-3 w-3" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-caption leading-5">
        <code ref={codeRef} className={`hljs language-${language ?? ''} bg-transparent font-mono text-text-default`}>
          {children}
        </code>
      </pre>
    </div>
  );
}
